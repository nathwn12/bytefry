using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MemeFryer.Desktop;

/// <summary>
/// Host half of the bridge: one request in (<c>{id, command, args}</c>), one reply out
/// (<c>{id, ok, result|error}</c>). Every file the app reads or writes passes a dialog unless the
/// app names an explicit path, which is what the app's own self-test and batch export use.
/// </summary>
internal sealed class Bridge
{
    private const string DefaultOpenFilter =
        "Images (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.avif)|" +
        "*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.avif|All files (*.*)|*.*";

    private readonly IWin32Window _owner;
    private readonly string _appDir;
    private readonly string _userDataDir;
    private readonly bool _dev;
    private readonly Func<string> _browserVersion;
    private readonly Func<string, bool> _confirmReplace;

    internal Bridge(
        IWin32Window owner,
        string appDir,
        string userDataDir,
        bool dev,
        Func<string> browserVersion,
        Func<string, bool>? confirmReplace = null)
    {
        _owner = owner;
        _appDir = appDir;
        _userDataDir = userDataDir;
        _dev = dev;
        _browserVersion = browserVersion;
        _confirmReplace = confirmReplace ?? (path => AskToReplace(owner, path));
    }

    /// <summary>
    /// The replacement confirmation. It is asked here, after the destination has been read, rather than
    /// left to the Save dialog's own prompt: the dialog asks before this code has seen the file, so its
    /// yes could not be tied to the file that is actually there. Default is no — a dismissed dialog
    /// must not replace anything.
    /// </summary>
    private static bool AskToReplace(IWin32Window owner, string path) =>
        MessageBox.Show(
            owner,
            $"A file already exists at:\n\n{path}\n\nReplace it?",
            "Bytefry — replace file",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning,
            MessageBoxDefaultButton.Button2) == DialogResult.Yes;

    /// <summary>Returns the reply JSON, or null when the message is not a bridge request.</summary>
    internal async Task<string?> HandleAsync(string json)
    {
        JsonObject? message;
        try
        {
            message = JsonNode.Parse(json) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }

        if (message is null) return null;
        if (message["id"] is not JsonValue idValue || !idValue.TryGetValue<double>(out var id)) return null;

        var command = ArgString(message, "command") ?? string.Empty;
        var args = message["args"] as JsonObject ?? new JsonObject();

        try
        {
            var result = await ExecuteAsync(command, args).ConfigureAwait(true);
            return new JsonObject
            {
                ["id"] = id,
                ["ok"] = true,
                ["result"] = result?.DeepClone(),
            }.ToJsonString();
        }
        catch (Exception ex)
        {
            return new JsonObject
            {
                ["id"] = id,
                ["ok"] = false,
                ["error"] = $"{ex.GetType().Name}: {ex.Message}",
            }.ToJsonString();
        }
    }

    private async Task<JsonNode?> ExecuteAsync(string command, JsonObject args) => command switch
    {
        "hostInfo" => HostInfo(),
        "openImage" => await OpenImageAsync(args).ConfigureAwait(true),
        "saveImage" => await SaveImageAsync(args).ConfigureAwait(true),
        "copyImage" => CopyImage(args),
        _ => throw new InvalidOperationException($"unknown command '{command}'"),
    };

    private JsonNode HostInfo() => new JsonObject
    {
        ["host"] = "meme-fryer-desktop",
        ["platform"] = "win32",
        ["arch"] = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
        ["bridge"] = 1,
        ["hostVersion"] = typeof(Bridge).Assembly.GetName().Version?.ToString(3) ?? "0.0.0",
        ["browserVersion"] = _browserVersion(),
        ["framework"] = RuntimeInformation.FrameworkDescription,
        ["os"] = RuntimeInformation.OSDescription,
        ["dev"] = _dev,
        ["appDir"] = _appDir,
        ["userDataDir"] = _userDataDir,
        ["origin"] = $"https://{AppPaths.VirtualHost}",
    };

    private async Task<JsonNode?> OpenImageAsync(JsonObject args)
    {
        using var dialog = new OpenFileDialog
        {
            Title = ArgString(args, "title") ?? "Open image",
            Filter = ArgString(args, "filter") ?? DefaultOpenFilter,
            CheckFileExists = true,
            Multiselect = false,
            RestoreDirectory = true,
        };

        if (dialog.ShowDialog(_owner) != DialogResult.OK) return null;

        var path = dialog.FileName;
        var bytes = await File.ReadAllBytesAsync(path).ConfigureAwait(true);
        var mime = MimeFromPath(path);

        return new JsonObject
        {
            ["name"] = Path.GetFileName(path),
            ["path"] = path,
            ["mime"] = mime,
            ["size"] = bytes.LongLength,
            ["lastModified"] = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeMilliseconds(),
            ["dataUrl"] = $"data:{mime};base64,{Convert.ToBase64String(bytes)}",
        };
    }

    private async Task<JsonNode?> SaveImageAsync(JsonObject args)
    {
        var (bytes, detectedMime) = DecodePayload(args);
        var mime = ArgString(args, "mime") ?? detectedMime ?? "application/octet-stream";

        var target = ArgString(args, "path");
        var fromDialog = string.IsNullOrWhiteSpace(target);
        if (fromDialog)
        {
            var suggested = SanitizeFileName(ArgString(args, "suggestedName") ?? DefaultFileName(mime));
            using var dialog = new SaveFileDialog
            {
                Title = ArgString(args, "title") ?? "Export image",
                FileName = suggested,
                DefaultExt = ExtensionFor(mime),
                AddExtension = true,
                Filter = SaveFilter(mime, ArgString(args, "filter")),
                OverwritePrompt = false,
                RestoreDirectory = true,
            };

            if (dialog.ShowDialog(_owner) != DialogResult.OK) return null;
            target = dialog.FileName;
        }

        return await SaveToAsync(target!, fromDialog, bytes, mime).ConfigureAwait(true);
    }

    /// <summary>
    /// The save a chosen path goes through. Split out so the confirmation and the identity re-check can
    /// be exercised without a dialog or a window: <paramref name="fromDialog"/> is true only for a path
    /// the user picked, which is the only case where a replacement needs asking about.
    /// </summary>
    /// <param name="write">Test seam for the byte-writing step, so a test can change the destination
    /// while the save is running; production passes null.</param>
    internal async Task<JsonNode?> SaveToAsync(
        string target,
        bool fromDialog,
        byte[] bytes,
        string mime,
        AtomicSave.WriteBytes? write = null)
    {
        var full = Path.GetFullPath(target);

        var expected = AtomicSave.Observe(full);

        if (fromDialog && expected.State == DestinationState.Present && !_confirmReplace(full))
            return null;

        await AtomicSave.SaveAsync(full, bytes, expected, write).ConfigureAwait(true);

        return new JsonObject
        {
            ["path"] = full,
            ["size"] = bytes.LongLength,
            ["mime"] = mime,
        };
    }

    private JsonNode CopyImage(JsonObject args)
    {
        var (bytes, _) = DecodePayload(args);

        using var stream = new MemoryStream(bytes, writable: false);
        using var image = Image.FromStream(stream, useEmbeddedColorManagement: false, validateImageData: true);

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                Clipboard.SetImage(image);
                break;
            }
            catch (ExternalException) when (attempt < 5)
            {
                Thread.Sleep(60);
            }
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["width"] = image.Width,
            ["height"] = image.Height,
        };
    }

    private static (byte[] Bytes, string? Mime) DecodePayload(JsonObject args)
    {
        var dataUrl = ArgString(args, "dataUrl");
        if (!string.IsNullOrEmpty(dataUrl))
            return DecodeDataUrl(dataUrl);

        var base64 = ArgString(args, "base64");
        if (!string.IsNullOrEmpty(base64))
        {
            var cleaned = CleanBase64(base64);
            return (Convert.FromBase64String(cleaned), null);
        }

        throw new ArgumentException("expected dataUrl or base64");
    }

    private static (byte[] Bytes, string? Mime) DecodeDataUrl(string dataUrl)
    {
        if (!dataUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            return (Convert.FromBase64String(CleanBase64(dataUrl)), null);
        }

        var comma = dataUrl.IndexOf(',');
        if (comma < 0) throw new FormatException("malformed data URL: no comma");

        var header = dataUrl[5..comma];
        var payload = dataUrl[(comma + 1)..].Trim();

        string? mime = null;
        var isBase64 = false;
        foreach (var part in header.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.Equals("base64", StringComparison.OrdinalIgnoreCase)) isBase64 = true;
            else if (part.Contains('/')) mime = part;
        }

        if (!isBase64)
        {
            var decoded = Uri.UnescapeDataString(payload);
            return (Encoding.UTF8.GetBytes(decoded), mime);
        }

        return (Convert.FromBase64String(CleanBase64(payload)), mime);
    }

    private static string CleanBase64(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var ch in value)
        {
            if (char.IsWhiteSpace(ch)) continue;
            builder.Append(ch);
        }

        return builder.ToString();
    }

    private static string? ArgString(JsonObject? args, string name)
    {
        if (args?[name] is JsonValue value && value.TryGetValue<string>(out var text))
            return text;
        return null;
    }

    private static string SanitizeFileName(string name)
    {
        var cleaned = new string(name
            .Where(ch => Array.IndexOf(Path.GetInvalidFileNameChars(), ch) < 0 && ch != '\\' && ch != '/')
            .ToArray()).Trim();

        return string.IsNullOrEmpty(cleaned) ? "image.png" : cleaned;
    }

    private static string DefaultFileName(string mime) => "export" + ExtensionFor(mime);

    private static string ExtensionFor(string mime) => mime.ToLowerInvariant() switch
    {
        "image/png" => ".png",
        "image/jpeg" or "image/jpg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        "image/bmp" => ".bmp",
        "image/avif" => ".avif",
        "image/svg+xml" => ".svg",
        "image/tiff" => ".tiff",
        "application/json" => ".json",
        "text/plain" => ".txt",
        _ => ".png",
    };

    private static string SaveFilter(string mime, string? overrideFilter)
    {
        if (!string.IsNullOrWhiteSpace(overrideFilter)) return overrideFilter;

        var extension = ExtensionFor(mime);
        var label = mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? "Image" : "File";
        var pattern = extension == ".jpg" ? "*.jpg;*.jpeg" : $"*{extension}";

        return $"{label} ({pattern})|{pattern}|All files (*.*)|*.*";
    }

    private static string MimeFromPath(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" or ".jfif" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".bmp" => "image/bmp",
        ".avif" => "image/avif",
        ".svg" => "image/svg+xml",
        ".tif" or ".tiff" => "image/tiff",
        ".ico" => "image/x-icon",
        ".json" => "application/json",
        ".txt" => "text/plain",
        _ => "application/octet-stream",
    };
}
