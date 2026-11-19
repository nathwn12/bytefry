using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace MemeFryer.Desktop;

/// <summary>Whether the destination existed at the moment the save was given its path.</summary>
internal enum DestinationState
{
    /// <summary>Free when chosen (a new name in the Save dialog, or the self-check's unique name).
    /// A file that appears after that point was never confirmed for overwrite, so the save refuses it.</summary>
    Absent,

    /// <summary>Occupied when chosen and confirmed for replacement by the user, or named explicitly by
    /// a caller for a batch export. Replacing that file is what was asked for.</summary>
    Present,
}

/// <summary>
/// What the destination was when the path was chosen: whether it existed, and the identity needed to
/// tell the same file from a different one that merely shares its name.
/// </summary>
/// <param name="FileId">The file's index on its volume, from the operating system. Zero when the
/// filesystem does not report one, in which case identity rests on length and write time alone.</param>
internal readonly record struct DestinationSnapshot(
    DestinationState State,
    ulong FileId,
    long Length,
    long LastWriteUtcTicks)
{
    /// <summary>True when <paramref name="current"/> is the same file, unchanged, as this snapshot.</summary>
    internal bool SameAs(DestinationSnapshot current) =>
        State == current.State &&
        Length == current.Length &&
        LastWriteUtcTicks == current.LastWriteUtcTicks &&
        (FileId == 0 || current.FileId == 0 || FileId == current.FileId);
}

/// <summary>
/// Writes a file so that a failure cannot cost the reader what was already there.
/// </summary>
/// <remarks>
/// <para>
/// <c>File.WriteAllBytes</c> opens the destination for writing and truncates it before the first new
/// byte exists, so a write that dies part way — a full disk, an I/O error, a share that drops, a filter
/// driver that refuses the write — leaves the user's image truncated or half-written with no way back.
/// A save therefore never opens the destination: the bytes go to a uniquely named temporary file in the
/// destination's own directory, are flushed to disk, and the commit is one rename in that directory
/// (same volume, so the rename is atomic and a reader sees the old bytes or the new ones, never a
/// mixture).
/// </para>
/// <para>
/// The temporary is created with its own ACL — the current user and LOCAL SYSTEM, nothing inherited —
/// so an image saved into a shared, public or otherwise broadly readable folder is not exposed to that
/// folder's readers while it is half-written. A newly created destination gets the folder's inherited
/// permissions back at the end of the save, so the final file behaves like any other file in that
/// folder; a replaced destination keeps its own ACL, because <c>File.Replace</c> carries it over.
/// </para>
/// <para>
/// What may be replaced is decided once, by the caller, from a <see cref="DestinationSnapshot"/> taken
/// when the path was chosen. At commit time the destination must still be that same file — same
/// existence, same file index, same length, same write time — or the save refuses: a name that was
/// free and is now taken, a file that was replaced by a different one, and a file that was modified
/// after the user confirmed it are all refused rather than silently overwritten.
/// </para>
/// <para>
/// An existing destination is replaced with <c>File.Replace</c>, which carries its ACLs and attributes
/// onto the new content; a metadata failure is fatal, and there is no move-over fallback, because that
/// would silently hand the file the temporary's permissions instead of the user's.
/// </para>
/// <para>
/// Every failure before the commit leaves the destination exactly as it was, and the only file this
/// class ever deletes is the temporary it created.
/// </para>
/// </remarks>
internal static class AtomicSave
{
    /// <summary>The bytes-to-stream step. Replaceable so a test can fail the write, let another program
    /// win the name, or change the destination, after the temporary file exists and before the
    /// destination is touched.</summary>
    internal delegate Task WriteBytes(Stream stream, byte[] bytes);

    /// <summary>Prefix and suffix of the temporary name; unique per call, and never a user's name.</summary>
    internal const string TempPrefix = ".bytefry-";

    internal const string TempSuffix = ".tmp";

    /// <summary>
    /// What the destination is now: existence plus identity. Call this when the path is chosen — right
    /// after the confirmation that names the file, or before staging an explicit path — never inside
    /// the commit, and never to re-decide what the user was shown.
    /// </summary>
    internal static DestinationSnapshot Observe(string path)
    {
        var full = Path.GetFullPath(path);

        var info = new FileInfo(full);
        if (!info.Exists)
            return new DestinationSnapshot(DestinationState.Absent, 0, 0, 0);

        return new DestinationSnapshot(
            DestinationState.Present,
            FileIdOf(full),
            info.Length,
            info.LastWriteTimeUtc.Ticks);
    }

    /// <summary>Writes <paramref name="bytes"/> to <paramref name="path"/>, atomically.</summary>
    /// <param name="expected">The destination as it was when the path was chosen.</param>
    /// <returns>The full path that now holds the bytes.</returns>
    /// <exception cref="ArgumentException">The path carries no directory.</exception>
    /// <exception cref="IOException">
    /// The bytes could not be written, the destination could not be replaced, or it is no longer the
    /// file that was confirmed; the destination is unchanged, and the message says so.
    /// </exception>
    /// <param name="write">Replaces the bytes-to-stream step; production passes null.</param>
    /// <param name="staged">Handed the temporary file's path as soon as it exists and before a byte is
    /// written, so a test can inspect what is being exposed while the image is being written.</param>
    internal static async Task<string> SaveAsync(
        string path,
        byte[] bytes,
        DestinationSnapshot expected,
        WriteBytes? write = null,
        Action<string>? staged = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(bytes);

        var destination = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(destination);
        if (string.IsNullOrEmpty(directory))
            throw new ArgumentException($"path has no directory: {path}", nameof(path));

        if (Directory.Exists(destination))
            throw new IOException($"a folder already exists at {destination}");

        Directory.CreateDirectory(directory);

        var (temp, stream) = CreateTemp(directory);
        staged?.Invoke(temp);

        try
        {
            await using (stream)
            {
                if (write is null)
                    await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
                else
                    await write(stream, bytes).ConfigureAwait(false);

                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);

                stream.Flush(flushToDisk: true);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            DeleteTemp(temp);
            throw new IOException(
                $"{destination} was not changed: its new bytes could not be written ({ex.Message})", ex);
        }
        catch
        {
            DeleteTemp(temp);
            throw;
        }

        try
        {
            Commit(temp, destination, expected);
            return destination;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            DeleteTemp(temp);
            throw new IOException(
                $"{destination} was not changed: {ex.Message}", ex);
        }
        catch
        {
            DeleteTemp(temp);
            throw;
        }
    }

    /// <summary>
    /// A name in the destination's own directory, created exclusively with its own ACL before a single
    /// byte is written: <c>CreateNew</c> refuses to adopt a file this class did not create, which is
    /// what makes deleting it afterwards safe.
    /// </summary>
    private static (string Path, FileStream Stream) CreateTemp(string directory)
    {
        for (var attempt = 0; attempt < 8; attempt++)
        {
            var candidate = Path.Combine(directory, TempPrefix + Guid.NewGuid().ToString("N") + TempSuffix);
            try
            {
                return (candidate, new FileInfo(candidate).Create(
                    FileMode.CreateNew,
                    FileSystemRights.FullControl,
                    FileShare.None,
                    bufferSize: 64 * 1024,
                    FileOptions.Asynchronous,
                    OwnerOnlySecurity()));
            }
            catch (IOException) when (File.Exists(candidate))
            {
            }
        }

        throw new IOException($"could not create a temporary file in {directory}");
    }

    /// <summary>
    /// The staging file's ACL, applied as it is created: the current user and LOCAL SYSTEM only, with
    /// inheritance off. Without it the file inherits whoever can read the folder, which would expose a
    /// half-written image in a shared, public or synchronised folder for the length of the write.
    /// </summary>
    private static FileSecurity OwnerOnlySecurity()
    {
        var security = new FileSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);

        const FileSystemRights full = FileSystemRights.FullControl;
        security.AddAccessRule(new FileSystemAccessRule(
            WindowsIdentity.GetCurrent().User
                ?? throw new InvalidOperationException("the current user has no security identifier"),
            full,
            AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            full,
            AccessControlType.Allow));

        return security;
    }

    /// <summary>
    /// The folder's permissions again, for a file this class created: inheritance is switched back on
    /// with no explicit entries, so Windows recomputes what the parent grants and the saved image is
    /// readable exactly where any other file in that folder would be.
    /// </summary>
    private static void RestoreInheritance(string destination)
    {
        try
        {
            var security = new FileSecurity();
            security.SetAccessRuleProtection(isProtected: false, preserveInheritance: false);
            new FileInfo(destination).SetAccessControl(security);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"[meme-fryer] could not restore inherited permissions on {destination}: {ex.Message}");
        }
    }

    /// <summary>
    /// One rename: the destination holds either the old bytes or the new ones, never both, and never a
    /// file other than the one the caller saw when the path was chosen.
    /// </summary>
    private static void Commit(string temp, string destination, DestinationSnapshot expected)
    {
        if (expected.State == DestinationState.Absent)
        {
            if (File.Exists(destination))
            {
                throw new IOException(
                    $"a file appeared at {destination} after the name was chosen; it was not replaced");
            }

            File.Move(temp, destination);
            RestoreInheritance(destination);
            return;
        }

        var current = Observe(destination);

        if (current.State == DestinationState.Absent)
        {
            File.Move(temp, destination);
            RestoreInheritance(destination);
            return;
        }

        if (!current.SameAs(expected))
        {
            throw new IOException(
                $"the file at {destination} changed after it was confirmed for replacement; it was not replaced");
        }

        try
        {
            File.Replace(temp, destination, destinationBackupFileName: null, ignoreMetadataErrors: false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new IOException($"it could not be replaced ({ex.Message})", ex);
        }
    }

    /// <summary>Removes this call's temporary only, and never masks the failure being reported.</summary>
    private static void DeleteTemp(string temp)
    {
        try
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    /// <summary>
    /// The file index the volume assigned, which is what tells one file from another that reuses its
    /// name. Zero when the filesystem reports none (some network shares), so the caller's identity
    /// check falls back to length and write time; an unreadable file also reports zero, and the
    /// replace that follows will fail on its own terms if it cannot be written.
    /// </summary>
    private static ulong FileIdOf(string path)
    {
        try
        {
            using var handle = File.OpenHandle(
                path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);

            if (!GetFileInformationByHandle(handle, out var information))
                return 0;

            return ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return 0;
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle handle,
        out ByHandleFileInformation information);

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        internal uint FileAttributes;
        internal uint CreationTimeLow;
        internal uint CreationTimeHigh;
        internal uint LastAccessTimeLow;
        internal uint LastAccessTimeHigh;
        internal uint LastWriteTimeLow;
        internal uint LastWriteTimeHigh;
        internal uint VolumeSerialNumber;
        internal uint FileSizeHigh;
        internal uint FileSizeLow;
        internal uint NumberOfLinks;
        internal uint FileIndexHigh;
        internal uint FileIndexLow;
    }
}
