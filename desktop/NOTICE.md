# Licence — Bytefry

Bytefry is distributed under the **GNU General Public License, version 3 only** (`GPL-3.0-only`).

That is deliberate, and it is the conservative reading: the web app in `app/` is a modified version of
*Meme Deep Fryer* by Dima and contributors (`github.com/efskap/deepfriedmemes.com`), whose licence text
is version 3 of the GPL and whose grant carries no "or any later version" option. A derivative cannot
add a permission the original withholds, so this build claims version 3 only.

The full licence text ships verbatim as `app/LICENSE` — beside this file in a portable or installed
copy, and at `../app/LICENSE` in the source tree. It is never edited. The desktop host in `desktop/`
is original work written for this repository; it is distributed under the same GPL version 3 only,
because it ships as one program with `app/`: one executable serving one bundle.

## Third-party software in the built host

| Component | Version | Licence | Use |
|---|---|---|---|
| Microsoft.Web.WebView2 (NuGet) | 1.0.4314.35 | BSD-style licence from Microsoft (`LICENSE.txt` in the package) | Hosts the bundled web app |
| Microsoft Edge WebView2 Runtime | installed on the machine, not redistributed | Microsoft licence | Embedded browser engine |
| .NET 10 runtime | bundled only in the self-contained build of `Bytefry.exe` | MIT | Host runtime |
| `app/vendor/caman.full.min.js` | shipped by the app lane | BSD-3-Clause, © 2010 Ryan LeFevre (text in `app/vendor/NOTICE`) | Image filters |
| `app/vendor/glfx.js` | shipped by the app lane | MIT, © 2011 Evan Wallace (text in `app/vendor/NOTICE`) | Bulge effect |

## What a distributable carries

`build.ps1` copies this file to the root of the portable folder and copies `app/` beside the
executable, so a built bundle carries every notice it needs:

| File in the bundle | What it is |
|---|---|
| `NOTICE.md` | this file: the licence of the combined work and the components above |
| `app/LICENSE` | the full GPL version 3 text, verbatim from the original project |
| `app/ATTRIBUTION.md` | the original work, the itemised changes, the bundled library licences |
| `app/vendor/NOTICE` | the licences of the two vendored libraries |

Nothing in the bundle is relicensed by the rename or by the build. GPL-3.0 obligations are not
satisfied by the licence text alone: any binary distribution must also ship or offer the
corresponding source of `desktop/` and `app/`.
