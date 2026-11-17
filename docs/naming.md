# Naming: what is Bytefry, and what still says MemeFryer

The product is Bytefry. Everything a user sees is named that way:

| Where | What it says |
|---|---|
| Executable | `Bytefry.exe` |
| Installer | `Bytefry-<version>-setup.exe`, display name `Bytefry`, same `AppId` as before the rename so an existing install upgrades in place |
| Window title, dialogs | `Bytefry`, `Bytefry - app bundle missing`, `Bytefry - WebView2 unavailable` |
| In-app title, page title | `Bytefry` |
| Uninstall entry | `Bytefry` |

## Pre-rename names that stay

Each of these is invisible in the product, and changing it would break something bigger than the name:

| Kept | Why |
|---|---|
| `%LOCALAPPDATA%\MemeFryer\WebView2` | an installed copy's WebView2 profile; renaming it needs a migration, not an edit. Uninstall leaves it in place, so a reinstall finds the state it had |
| `MEME_FRYER_DEV`, `MEME_FRYER_APP_DIR`, `MEME_FRYER_USER_DATA_DIR` | the configuration contract: documented here, used by the scripts and asserted by tests |
| Virtual origin `https://meme-fryer.local/` | internal to the WebView2 folder mapping; the app never shows it |
| Bridge `host: "meme-fryer-desktop"`, `[meme-fryer]` trace prefix | bridge contract v1 identity and diagnostics only |
| `desktop/MemeFryer.Desktop/`, `MemeFryer.Desktop.Tests`, `MemeFryer.ico`, `MemeFryer.iss` | build-internal paths and the namespace; the assembly name, product name and file description are all `Bytefry` |

`desktop/README.md` carries the same table with the detail behind each row, and is the authority if the two ever disagree.

## The upstream name is not renamed

*Meme Deep Fryer* is the name of the original work by Dima and contributors. It stays as written in
`app/ATTRIBUTION.md`, `desktop/NOTICE.md`, `app/LICENSE` and the in-app attribution dialog. Bytefry is
the name of this build.

## The repository

The repository is [`nathwn12/bytefry`](https://github.com/nathwn12/bytefry), and it carries two kinds of
tag: a version tag `vX.Y.Z` is the immutable source of record for a published build, and the release is
published under the tag `bytefry` at
<https://github.com/nathwn12/bytefry/releases/tag/bytefry>, which stays on commit `2ab8d0b` - the commit
of `v0.1.1` - while the release's assets move to each new version. It carries 0.1.2's three downloads now.
`v0.1.0` has no release page or downloads any more; its tag remains. The name of a local checkout folder
is not part of the product and is not recorded here.

## Leftover from an upgrade

An install upgraded across the rename can leave the old `MemeFryer.exe` beside `Bytefry.exe`. It still
runs, because it finds the same `app\`, but nothing names it any more: the shortcut, the installer and the
uninstall entry all point at `Bytefry.exe`. Deleting it by hand is safe; nothing removes it automatically.
