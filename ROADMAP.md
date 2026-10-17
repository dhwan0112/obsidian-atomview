# AtomView roadmap

Updated 2026-10-17. Planned priorities: playback multipliers, color controls, editing, GIF export. Items below are planned unless explicitly marked implemented and validated in TEST_REPORT.md. No release dates are promised.

## P0 — reliability and the large-trajectory vertical slice (tested baseline; remaining stress scope documented)

- Fix Reading-view starvation after four offscreen embeds; verify PDB/CIF while scrolling the real demo, then return to earlier embeds.
- Disk-backed uncompressed LAMMPS dump: immediate first frame, cancellable byte index, asynchronous random access, latest-seek-wins, bounded frame cache, transferable Float64 coordinates and reusable Mol* sphere buffers.
- Explicit read-only registration of selected Dropbox files, opaque source IDs, revocation, changed-file detection. Keep originals unchanged and default ordinary paths vault-contained.
- End-to-end actual Obsidian checks on representative ~898 MiB / 2,625-atom and ~460 MiB / 3,080-atom sources. Report first ready time, indexing, seek latency, short playback sample and memory scope honestly.
- Fixed ranges must state whether they are explicit, reference-frame-derived or scanned global extrema. Frame index and source timestep remain separate.
- Outstanding clipboard repeatability and large-absolute-coordinate rendering precision remain tracked separately in KNOWN_ISSUES.md.

Completion gate: typecheck, scientific/unit tests, production build, offline isolated renderer tests and real test-vault checks pass; generated files are inventoried; unsupported cases are documented.

## P1 — playback speed and color controls

### Playback speed

Existing: requested 0.2–30 displayed frames/second. Planned:

- Speed presets 0.25×, 0.5×, 1×, 2×, 4× and a numeric multiplier, with a visible base rate.
- Separate source-frame stride from playback multiplier. Never silently relabel a skipped frame or invent physical time.
- Show requested versus achieved display rate and loading state. Offer explicit “show every frame” / “skip display frames to keep pace” policies.
- Loop, playback start/end frame range, reverse playback and keyboard controls. Preserve independent embed state.
- Use physical-time labels only when units and timestep spacing are explicitly known; otherwise label frames/s and source timestep.
- Extend the versioned copied-block schema with migration/default behavior for older blocks.

Acceptance: deterministic frame sequences under slow reads, multiplier/stride separation, responsive seek/pause/cancel, unchanged camera, independent widgets and restored state.

### Color adjustment

Existing: element/type/scalar coloring, explicit vector component/magnitude, fixed or per-frame ranges. Planned:

- Element/type color picker and reusable palettes, including accessible palettes and dark/light preview.
- Scalar palette selector, reversal, explicit low/high bounds, missing-value display and clear clipping indication.
- Reference-frame / explicit / scanned-global range controls with progress/cancellation; never change an active scale silently.
- Representation display settings such as sphere size, background and cell color/width.
- Save palettes and all view-only color settings in copied blocks; offer reset to defaults.

Acceptance: known scalar endpoints/midpoint, absent values and out-of-range values are distinct; frame changes keep fixed-scale meaning; copy/restore reproduces colors.

## P2 — explicit editing with undo and new-file output

Start with a small, explicit edit session on a selected frame, separate from display-only changes.

- Selection tools and original-ID-based selection lists; translate/rotate selected atoms and edit a selected coordinate.
- Add/delete atoms and edit confirmed element/type only after a complete ID/topology policy is implemented.
- Undo/redo, dirty-state indicator, cancel edits, source-versus-edited coordinate inspection and edit history.
- Choose edit scope explicitly: current frame first. Whole-trajectory transforms require a separate, later implementation.
- Save As to a user-selected new file; never automatically overwrite a source, Dropbox research file or existing note.
- Advertise only lossless export paths actually implemented. Preserve cell/origin/PBC, IDs, types, scalar/vector properties and units; reject unsupported topology/property loss instead of silently exporting generic XYZ.
- Editable charges or other scientific properties require an explicit property editor; do not treat visual color changes as source-property edits.

Acceptance: undo restores exact Float64 source values and IDs, edits do not touch originals, export/re-import round-trips supported fields, topology inconsistencies are detected, and unsupported exports fail clearly. Atomic-number inference from LAMMPS type or mass remains forbidden.

## P3 — local GIF export

- Export a selected frame interval with explicit stride, dimensions, output FPS and loop count.
- Render with a locked camera, palette/range, mapping, representation, cell and optional frame/timestep annotation.
- Encode locally in a bundled worker; no CDN, remote upload or Python/server runtime requirement.
- Bounded pixel/frame/encoder memory and output-size limits; progress, cancel and worker/resource cleanup.
- Save a new GIF through an explicit destination choice; include a reproducible settings summary in optional companion metadata.
- GIF's indexed colors may affect scalar legends; preview the encoded result and retain a precise source configuration alongside it when requested.

Acceptance: decode the generated GIF independently, verify dimensions/frame count/delays, compare representative exported scenes, test cancellation and repeated export cleanup, and verify offline operation in actual Obsidian.

## Later / separate scope

Persisted on-disk indexes and append-only growing trajectories; compressed/binary formats; broader lazy-format readers; large-coordinate render-origin handling; advanced Live Preview; native embeds; distances/supercells/RDF/MSD; mobile. These are not prerequisites for the four planned feature tracks above.

Stability baseline update: 44 automated tests and actual-host lifecycle/large-file checks pass, including a ~30-second playback sample. See TEST_REPORT.md for exact scope and limits; this does not mark the later feature tracks implemented.
