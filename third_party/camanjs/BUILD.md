# CamanJS 4.1.2 — the upstream source behind `app/vendor/caman.full.min.js`

The app ships one minified file for its filter pipeline. It has no header, no
source map and no version string, so nothing inside it says what it is. This
folder is the upstream source it was built from, at the exact commits, with the
hashes that prove the match.

Scope: CamanJS only. `glfx.js` is a different library and is not covered here.

## Pinned upstream

| | |
|---|---|
| Package | `caman` 4.1.2 |
| Repository | <https://github.com/meltingice/CamanJS> |
| Commit | `36697e053d0b8f3b5cc58fba274b5cd65cb219c2` — `refs/tags/v4.1.2^{}`, "Version bump", 2013-07-27 |
| Licence | BSD-3-Clause, `upstream/LICENSE` |
| Plugins repository | <https://github.com/meltingice/CamanJS-Plugins> |
| Plugins commit | `60696a50de8987e0fed6e3dde52ef93d0c124fee`, 2013-07-17 |
| Artifact | `upstream/dist/caman.full.min.js`, 78,214 B, git blob `803c2ef65940a5eeca3babec178e5cfbd6348d52` |

`src/plugins` is a gitlink in the CamanJS tree, so the plugin source lives in its
own repository; see [The plugins submodule](#the-plugins-submodule).

## The shipped file is that artifact

Three rows, taken today, each one byte-exact:

| File | Bytes | Blob / hash |
|---|---|---|
| `app/vendor/caman.full.min.js` as shipped | 78,452, 238 CRLF | sha256 `2994386943f69b79501cf8b38556bcb9d6cf80bdeb4abaedb5002958ef241aca` |
| the same file after CRLF→LF | 78,214 | git blob `803c2ef65940a5eeca3babec178e5cfbd6348d52`, sha256 `4ed8fa29ed8dceec62e6ea4f9477ad919c41b5d4ead0b57567a044514b0a3dfb` |
| `upstream/dist/caman.full.min.js` (v4.1.2) | 78,214 | git blob `803c2ef65940a5eeca3babec178e5cfbd6348d52` |

The arithmetic closes: 78,214 + 238 carriage returns = 78,452. Nothing but the
line endings differs, and normalising them reproduces the published artifact
byte for byte.

For completeness of the chain, the same blob is also what the original project
stores: `deepfriedmemes.com` at `55db6d6bea0007a6b016102eb5d1ad119bc50ca2` has
`vendor/caman.full.min.js` at blob `803c2ef65940a5eeca3babec178e5cfbd6348d52`.
This app's copy therefore equals both the upstream artifact and the original
project's copy, on the same evidence.

Reproduce any of it against the live repository:

```sh
git clone https://github.com/meltingice/CamanJS.git
git -C CamanJS rev-parse 'v4.1.2^{commit}'    # 36697e053d0b8f3b5cc58fba274b5cd65cb219c2
git -C CamanJS rev-parse 'v4.1.2:dist/caman.full.min.js'
                                              # 803c2ef65940a5eeca3babec178e5cfbd6348d52
```

`git rev-parse <rev>:<path>` prints the blob id and never consults the working
tree, so `core.autocrlf` cannot colour the answer. `git show` and `git archive`
can and do: with `core.autocrlf=true` both hand back CRLF. Use `git cat-file
blob` or `git hash-object --no-filters` when a byte-level answer matters.

## What the build does

`upstream/Cakefile` is the whole recipe, and it is short:

1. Concatenate the twenty `.coffee` files named in `coffeeFiles`, in that order,
   into `dist/caman.coffee`. The order is load-bearing: `core/module` and
   `core/util` first, then `core/caman`, then the rest.
2. Append the same concatenation plus `"\n\n"` and then, for every non-directory
   file in `src/plugins/src`, that file's contents and another `"\n\n"`. That is
   `caman.full.coffee` — the core library with the plugins, which is why the
   bundle is named `.full`.
3. Compile with CoffeeScript (`coffee -j`) and minify with `jsmin`.

**No CamanJS toolchain was run.** No `npm install`, no `cake`, no `coffee`, no
`jsmin`, and nothing was fetched but the two git clones this source was read
from. The identity above rests on hashing the published artifact, not on
recompiling it, so no third-party build tool touched this project.

## Source completeness

The bundle is only explained if the source is all of it. Three checks, all
enforced by `verify.mjs`:

- **The twenty core files are here.** The `coffeeFiles` list holds 17 under
  `src/core` (`module`, `util`, `caman`, `analyze`, `autoload`, `blender`,
  `calculate`, `convert`, `event`, `filter`, `io`, `layer`, `logger`, `pixel`,
  `plugin`, `renderer`, `store`) and 3 under `src/lib` (`blenders`, `filters`,
  `size`). All twenty are present.
- **The nine plugin files are here.** `src/plugins/src/` holds `blur`, `camera`,
  `compoundBlur`, `edges`, `posterize`, `presets`, `rotate`, `stackBlur`,
  `threshold`, plus the plugin repository's `README.md`.
- **The registration sets match exactly.** CamanJS registers three kinds of
  thing: filters, plugins and blenders. The bundle contains 67 `register("…")`
  names; the vendored sources declare 67 — 52 filters, 5 plugins, 10 blenders.
  No name is in one and not the other.

That third check is also what pins the plugin commit. The plugin repository at
its head (`cae934b`, 2014) adds `dither.coffee`, which registers `dither`. The
bundle has no `dither`, so the bundle was built from `60696a50` and not from a
later state of the plugin repository. The vendored copy is that exact commit.

## Line endings

Upstream is LF throughout. The app's copy is CRLF: it holds 238 line breaks, all
238 are CRLF and not one is a lone LF, which is why the size differs by exactly
238 bytes and why a plain `diff` against the upstream file reports a change on
every line while the content is identical.

`.gitattributes` marks `app/vendor/**` as `-text`, so git normalises nothing
there and the CRLF form is the one the tree holds. Deepfriedmemes.com stores the
LF form (the blob above), so the CRLF most likely entered through a Windows
checkout before that attribute existed. Either way it is the shipped form now.
Do not "fix" it to LF: that changes the payload's bytes for no functional gain,
and `verify.mjs` would refuse it, correctly.

## The plugins submodule

`src/plugins` is recorded in the CamanJS tree as a gitlink — a commit pointer to
a different repository — so it is not part of a plain checkout. This folder holds
a **static copy** of its contents at that commit, under
`upstream/src/plugins/`, exactly where the submodule would sit. `upstream/`
therefore builds as-is, with the Cakefile unmodified.

To reconstruct the real submodule instead:

```sh
git clone https://github.com/meltingice/CamanJS.git
cd CamanJS
git checkout 36697e053d0b8f3b5cc58fba274b5cd65cb219c2
git submodule update --init src/plugins
git -C src/plugins rev-parse HEAD   # 60696a50de8987e0fed6e3dde52ef93d0c124fee
```

`upstream/.gitmodules` is kept verbatim as the record of the two submodules and
their URLs. It is inert: no repository configures `third_party/camanjs/upstream`
as a submodule, so a commit here stores the plugin files as ordinary blobs. The
other submodule it names, `test/qunit`, is a test dependency and is not vendored.

## Licence

`upstream/LICENSE` is the BSD-3-Clause text from the pinned commit, reproduced
verbatim and unmodified: 1,481 bytes, sha256
`946898e76adf70cdf1da4fc2db312ec285adb26b60dd4207f83f34c2efa0f940`. It is the
authority for the notice, and `app/vendor/NOTICE` reproduces it in full — the
block between that file's two marker lines, with the single line break before the
end marker removed, is this file byte for byte, same size and same sha256, which
was checked rather than assumed. BSD-3-Clause requires the copyright notice to
accompany a binary redistribution and the minified bundle carries no header of
its own, so that notice is the only place the notice appears; it is doing real
work, not decoration.

Its first line reads `Copyright (c) 2010, Ryan LeFevre`, not the year range
several package indexes show. `2010-2016` is CamanJS master's `LICENSE`, whose
first line changed on 2016-06-08 (`25502b14b5afe61d8180666313511a4a6498318a`) — a
later text than the version this app ships. The pinned wording is the one used,
and this folder is where that wording comes from; `app/ATTRIBUTION.md` cites it
in the same terms.

One detail that matters when comparing copies: the pinned file has no trailing
newline — its last byte is `.` — so a copy that ends in a newline is 1,482 bytes
and is not the same file.

## Verification

```sh
node third_party/camanjs/verify.mjs
```

Offline, dependency-free, no git. Exit 0 prints the chain; exit 1 names the
assertion that broke. It checks the shipped bytes and their sha256, the CRLF
count, the CRLF→LF hash and blob id against the vendored artifact, the file count
and byte total of this folder, and the registration sets of source versus bundle.

The check was proven able to fail before it was trusted, on three throwaway
copies:

| Control | Result |
|---|---|
| one byte flipped inside the shipped bundle | exit 1 — shipped sha256, normalised sha256 and blob id all diverge |
| `presets.coffee` deleted from the vendored sources | exit 1 — 39 files, 22 registrations absent (`vintage` first) |
| shipped bundle re-saved with LF | exit 1 — 78,214 bytes, 0 CRLF |

## Manifest

40 files, 211,901 bytes. `blob` is the id in the upstream repository, so each
file can be checked against GitHub on its own; `sha256` is of the bytes in this
folder. Every blob id below was confirmed by `git hash-object --no-filters` on
the file as written here, with no mismatch.

| Path | Bytes | Blob | SHA-256 |
|---|---|---|---|
| `.codoopts` | 92 | `8c2e07f232f798836853dc5a0a8eb494d5f07f53` | `6b7d86d72b21fd58f9f28ede3b494a1356c053ed1e8d4b27f10d7ac77b643d62` |
| `.gitmodules` | 190 | `b3087377df5de91cc230c9e3966471e52d87c03c` | `8bd44a0a6db46f38f27c392833cced0aafe2ff2a56e9ee618c1bb1dc66beb04b` |
| `.npmignore` | 37 | `cc97952f2305369712f40f669bbaa6e43899e46e` | `fed3ff990e884faefe7f5a2023e58004c0c1105d0d546aa9cb4c4098ac192110` |
| `Cakefile` | 6223 | `0b2cc7bd4396a2e2defacdfe9b7706d0222d2e7d` | `3cc898baebd76b4522130fc462924397903d3a671b91af4f7d43c1a18f8de0c0` |
| `LICENSE` | 1481 | `c1faabd2a0b357309f792c1a9ccdf719496d733a` | `946898e76adf70cdf1da4fc2db312ec285adb26b60dd4207f83f34c2efa0f940` |
| `README.md` | 5149 | `04a70d61dfba217f57720b9ee244e05b493b5614` | `388b966853d377980ae0171fff893cad1ec0e9e2f3f3694bb1fe64df53d170c5` |
| `bower.json` | 221 | `00465446788e99a7e33cf1c7a75b6b67c6e84ee8` | `ed3c263559f0b06b8b0992eabd7816b098bd722fcac9463d8b4d053d15249e49` |
| `dist/caman.full.min.js` | 78214 | `803c2ef65940a5eeca3babec178e5cfbd6348d52` | `4ed8fa29ed8dceec62e6ea4f9477ad919c41b5d4ead0b57567a044514b0a3dfb` |
| `karma.conf.js` | 2356 | `d5d7ebbf12fa7c02046e64b441526a3e5d19aa90` | `9f827f9bb084c5b8eeb3e31a468f23d70fe5484e6b2205e646568a37463f7bbe` |
| `package.json` | 1630 | `05710924c4703a4f08caf306f09b98e10f066874` | `073ba1224e8fc7a1f7b957fa2ff2859fbd9edbbf26f21ad4afa2c6694df84fe0` |
| `src/core/analyze.coffee` | 967 | `b1172b4b7654ce471f656882bbb534ca96f72557` | `bed9da9d832a6006e30bb16ca493506e4440f230aca2e1bb1346e7481535f7e1` |
| `src/core/autoload.coffee` | 2206 | `30d7aa6f8c0fb190de97e619dcba5c7fa5c69427` | `03c22548a8a944721c2c2ed6b04eb970e483348f460392b2dc3b46fd00bc7acf` |
| `src/core/blender.coffee` | 838 | `b4b4ffe14ffca1ce4b07a1473f349a92ee371b8c` | `be661ac4275228f5b36a55206e890b3ed033e214236b64f73538d5bcd20f035c` |
| `src/core/calculate.coffee` | 4676 | `8bc8b2c52e26aec17ed341c5f5d982d84cbbfc92` | `c6856ae8b852ea47bc8ad43f2f4529d273fbc38497000d857e529b7ed7b56d0c` |
| `src/core/caman.coffee` | 20728 | `3c7739a576310eeff56097c6cea4aeb0f983f283` | `37b250ce23e9d7813c52c6a5b092b6066d703892f191b7b0d783f61e4fe71fd9` |
| `src/core/convert.coffee` | 9693 | `dedeea78d1d32dab237f10e0780b909ade8f7f0c` | `7230ae68180ea80e4a6853e8d763eaa6289ab0528b119fec1b33082c4173960d` |
| `src/core/event.coffee` | 1733 | `60efac7ddc38d265c4c67a4903e6621b64ac7480` | `6132699be0a2668414f4f1d9f1def6d3a7334649df34f777fdaa9be8f24b616b` |
| `src/core/filter.coffee` | 457 | `7c53ca372ebc8973c0e34e3e32be16965c72c426` | `3e83488a2e9c8aa3d5265c13826d6f02b8d858353974e4af298b993b4165e21d` |
| `src/core/io.coffee` | 3694 | `4d7d5370f2af69cc8bf0257ce73b5c1ce9f30464` | `0e7bd1180f99064c37097256bffc4f7c9a4899f344380fb9ec71bbdc5aea1711` |
| `src/core/layer.coffee` | 3979 | `b4d24338a75643fb3eba93cde126f1fd8284f0b0` | `8e1f6e91179f636760e1367f9ccd0a32e0032d9ccce1b3e5bbc9e9150b9c20a9` |
| `src/core/logger.coffee` | 457 | `7a9a16333f69e47470964f493e91ff84aa659888` | `0325dbf892da3abe2e8cf252147b0eb5ae34633db349aedd7e800297d6211be3` |
| `src/core/module.coffee` | 2359 | `0e7e6853da36cdd98f0b764f1379d39d059b3d55` | `403f3ea258eaccbe01739952e62168b8857352d156dd5b2ab5029bf7b2ea94f3` |
| `src/core/pixel.coffee` | 2821 | `100a68f2bb1d4a28cc4f2eb4e9bda967c43eb663` | `4d3ccf7c552bc8e4820166a272f14b14ed67137ca12e1bb0ef9c01ad40acffd0` |
| `src/core/plugin.coffee` | 227 | `a071c7fd24fef795c84baa84aaca3297cfd3284d` | `26046c9ec6de9bcdcbcb133f1df5d8005d75fd8a96d820157d67da5b18350b41` |
| `src/core/renderer.coffee` | 6662 | `7f83b8a7f570156ef613f9462521b1f8366bffb4` | `bb9756b2f71dce796e49bb3a22d78b9c84bac5a43d63dbbb10fed57695003128` |
| `src/core/store.coffee` | 564 | `9abe069814468d1451b19bc078eeb10e34cb7200` | `014f6a1445323750fbffb7edf287289a0ade658d2718b586c63d105177684018` |
| `src/core/util.coffee` | 1153 | `0b256d08a09aaa4711e758636f436e388735cb98` | `d8d3145cd1625a408cbe2c11c1e6c540ce05c55f8314c652e152af29b750e36b` |
| `src/lib/blenders.coffee` | 2914 | `4527556554b29bdc54f051c076b0c88c8b46c89d` | `5e243c8e4d40fa6068373c5e297bc0bd690736846ba2b0a945165573a3248bc9` |
| `src/lib/filters.coffee` | 11888 | `f872acf3669e915d8fceac16e8f7c4f6a95c68aa` | `17055ba099eb56d531f9a80d1f1fe11be4097099349f45970eca7c6f286aa78f` |
| `src/lib/size.coffee` | 1747 | `4ff7477ec47e1f6465b0c63c81f0fa8a9dda52f0` | `75be2feb119f6158c0754809e93c4c807073eda8fd3b6460c67e4b122e3472d0` |
| `src/plugins/README.md` | 470 | `698a0956ea686b73ca3ec77fd27ba8720c05c827` | `110843f5cc6cc89d3af6392c42867df3bc95b0ae8951a2d4f062ae4d156f7d85` |
| `src/plugins/src/blur.coffee` | 1363 | `6aca5e0af15c631953f74aba2b0c0a0e86a68b31` | `e4c94c8b6b49823a9afd0a8a1c83aa0f4adf117e7a7b93c9a014bf1cedd2c680` |
| `src/plugins/src/camera.coffee` | 5817 | `925d5df1020677dd27715cd6ec34fa512debbbab` | `efbb61cd4b2332ac95b056c6a012a2a7f248035673aa408661563e7bca5bf871` |
| `src/plugins/src/compoundBlur.coffee` | 12852 | `c1e65ca5cc48f99ca9eb007c964531fb5f751646` | `5cfa71d32706355695d41e39a4e4a320c3e2d89efe568a08b44f6d6ad880b496` |
| `src/plugins/src/edges.coffee` | 351 | `b755494470da741962fe3a0ac9a0c4ae0271f7ca` | `44799997caa8a9fd2930d6c7d100e07c954c6a04fd662fdbe741c7e0853c25f2` |
| `src/plugins/src/posterize.coffee` | 363 | `08209eaeefbbb2e2ada8d4ec9a274c19ba002237` | `9368bfcb8f4fb896ad16f80054cee38a8fcdeab5800528caed8ae98c8e5f1e30` |
| `src/plugins/src/presets.coffee` | 5083 | `3bed8804955179617e6bb5d9acb5d74d53fded0b` | `b95eff270be89c26e05198af84f1b7fa9bd08c080b175d4236d60161f614870d` |
| `src/plugins/src/rotate.coffee` | 1139 | `405eaf72b8d5acd43c17335519047ece16b658d8` | `4cfba59af2354966006ca3cfa5e667c73ed7e1d60a8ddec45917f8e6c8b03c95` |
| `src/plugins/src/stackBlur.coffee` | 8795 | `3aeb0566b79baf043f1a9da17162f63fd8c44daa` | `8162b70b42948ea5a3e7d855c635ca4bb9a85bb679be1e932726a5e99a4ca4c8` |
| `src/plugins/src/threshold.coffee` | 312 | `37d27875db6a6a7970675ccb30a5b69009c9d201` | `dac6ba97fab4f085719f51790322e95cadeb3c5a2f3fa0d0f181c527726f23dc` |

## Deliberately not included

Generated or irrelevant to the build, so they are left out and recorded here by
blob id instead. Each is at `36697e05`:

| Path | Bytes | Blob |
|---|---|---|
| `dist/caman.full.js` | 114944 | `d983cd49fdc4adf8092e538374fcdeef0a637674` |
| `dist/caman.full.map` | 64929 | `4c63017db42adb4f5c27b01376b423344241b270` |
| `dist/caman.full.pack.js` | 45970 | `678365627d069b9c743706ff0b73d63ce2cb6481` |
| `dist/caman.js` | 70931 | `1ce2b878dc47e3bdf214a9a932fe4f3d57f9e187` |
| `dist/caman.map` | 41648 | `deef2837451234c77f137576c797d2ca4dc1c00c` |
| `dist/caman.min.js` | 49152 | `4d4e5ac15ddd338e43728757ee56f97586be309c` |
| `dist/caman.pack.js` | 28276 | `cb6580c87b4f0e2b8008d8b458bbc2d777769035` |

Also omitted: `api/` and `docs/`, which are generated HTML (codo and docco)
checked into upstream and carrying no build input; `test/` and `examples/`, which
need the `test/qunit` submodule and a browser; `adapters/jquery.js`,
`proxies/caman_proxy.php`, `.travis.yml` and the two image fixtures.

The other `dist/` artifacts are unminified or packed variants of the same build.
`dist/caman.full.js` is the direct input to `jsmin` for the file this app ships,
so anyone auditing the minified output against readable code should read that
blob rather than re-run the toolchain.
