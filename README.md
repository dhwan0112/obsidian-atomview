# AtomView

An experimental desktop Obsidian plugin for viewing local atomic structures and molecular-dynamics trajectories with Mol*. Maintained by [Kim Donghwan](https://github.com/dhwan0112).

Supports LAMMPS text dumps and data files, XYZ/basic extended XYZ, PDB, coreCIF and mmCIF. Everything runs locally: no Python server, CDN, OVITO/VMD installation or remote structure service is required.

**Preview status:** tested in Linux desktop Obsidian 1.14.4. Windows/macOS execution is not yet verified; mobile is unsupported. The community directory listing is published, but automated review has not yet passed; in-app installation is not yet confirmed.

## Install

1. Download the runtime files from [Releases](https://github.com/dhwan0112/obsidian-atomview/releases): `main.js`, `manifest.json`, `styles.css`, and `THIRD_PARTY_LICENSES.txt`.
2. Place them in `<your-vault>/.obsidian/plugins/atomview/`. For a custom config directory, use its `plugins/atomview/` folder instead. Do not nest another `atomview` folder inside it.
3. Reopen Obsidian normally and enable **AtomView** under Settings → Community plugins → Installed plugins. Community-plugin execution must be allowed in your own security settings.

When updating, back up the existing AtomView folder and replace only runtime files; preserve `data.json`. Do not replace the vault's other settings or plugins.

## Open a structure

Use **AtomView: Open with AtomView** and enter a vault-root-relative path, or right-click a supported file and choose **Open with AtomView**. Existing extension associations are preserved. Automatic `.data` association is off by default and optional; data files are content-validated and require a supported atom-style hint/setting.

- Drag to rotate, right-drag to pan, wheel to zoom; **Fit / reset** reframes the scene.
- Spheres, element/type colors, real cell wireframes and original-ID picking.
- Play/pause, previous/next, frame slider and requested 0.2–30 FPS. Frame indices are 0-based and separate from source timesteps; physical time is not invented.
- Scalar colors such as `q`, fixed bounds or explicit per-frame auto range. Vectors require a component or magnitude selection.
- Schema-versioned copy/restore of frame, camera, mapping, scalar range and selection. Clipboard denial provides a manual-copy panel.

No chemical bonds are inferred for LAMMPS. Type numbers and masses do not establish chemical elements; map types explicitly when needed. Source coordinates/IDs/properties are preserved independently of display buffers. See [FORMAT_SUPPORT.md](FORMAT_SUPPORT.md) for exact format semantics and rejection rules.

## Embed in a note

Copy `fixtures/fe-o-q.lammpstrj` from this repository into your vault at `structures/fe-o-q.lammpstrj`, then use Reading view:

```atomview
source: "structures/fe-o-q.lammpstrj"
format: lammps-dump
frame: 0
representation: spheres
colorBy: q
showCell: true
elementMap:
  1: Fe
  2: O
height: 420
```

Ordinary paths are vault-root-relative, normalized and checked for symlink escape. Invalid YAML, missing properties/files and invalid frames show an error inside the view. Embeds keep independent camera/playback state. Hidden viewports release resources and restore when visible. Manual **Release viewer** stays released until **Reload / retry**.

Basic Live Preview was smoke-tested, but advanced editor workflows are unverified. Native `![[structure.xyz]]` embedding is not implemented.

## Large trajectories and external files

Uncompressed text LAMMPS dumps use a byte index and bounded frame cache rather than loading the entire trajectory:

- Up to 2 GiB, 100,000 indexed frames, 50,000 atoms/frame and 16 MiB raw text/frame.
- The first frame can display before indexing finishes; the seekable range grows with the index.
- Indexing checks framing/row counts. Atom values and IDs are validated on frame access; indexing is not full scientific validation of every frame.
- At most four cached frames / 16 MiB **estimated storage** per disk-backed view. This is not a total process/GPU memory guarantee.
- Scalar fixed bounds initially come from the displayed reference frame and are labeled accordingly. Set explicit bounds or request **Scan full property range** for global extrema. A full property scan can take time and is cancellable.
- Changed/replaced files require reload. Indexes are cached in memory, not persisted to disk.

Other formats retain bounded in-memory loading: 16 MiB/file, 500 frames and 250,000 total atom records. Combined estimated widget reservations are capped at 128 MiB; at most four renderers initialize simultaneously.

To access an outside-vault file, explicitly run **AtomView: Register selected external file (read-only)** and select one absolute local path. Only that file is granted; sources are not copied, modified or uploaded. Settings → AtomView → **Revoke** removes its grant. Cloud files must be locally available.

**Multi-computer limitation:** external registrations contain device-specific paths. Registering the file on another computer creates a new source ID/view; it does not automatically repair old `external:…` embeds. Vault-relative files work when available at the same relative paths.

## Develop

Node >=22 and npm are required for development, not for running the installed plugin.

```sh
npm ci
npm run lint
npm run validate
npx playwright install chromium
npm run test:browser
node scripts/check-bundle.mjs
npm run deploy:dev -- --vault "/absolute/path/to/an/existing/vault"
```

Deployment requires an existing default `.obsidian` configuration, ownership validation and a successful build receipt. It backs up previous owned builds and preserves settings; it never changes security settings or the active-plugin list. `--plugin-only` after the vault argument updates runtime files without generating another synthetic demo.

`test:browser` uses real Mol*/WebGL/worker code with a **mocked Obsidian host**. Actual host verification is separate. See [TEST_REPORT.md](TEST_REPORT.md), [VALIDATION.md](VALIDATION.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

## Roadmap

Playback multipliers/stride controls, configurable palettes, explicit editing with undo/redo and new-file output, and local GIF export are planned. They are **not implemented** in this preview. See [ROADMAP.md](ROADMAP.md).

## License

MIT — Copyright (c) 2026 Kim Donghwan. Mol*, YAML and bundled dependencies retain their licenses and attributions; see [THIRD_PARTY.md](THIRD_PARTY.md) and the release's `THIRD_PARTY_LICENSES.txt`.
