# Architecture

## Boundaries and data

- `src/main.ts`: Obsidian FileView/registerView/registerExtensions, explicit open command/file menu, settings, Reading-view code-block processor and per-widget lifecycle. Only public Obsidian APIs are called; no registry monkey patch. Existing extension registrations cause Obsidian's registration call to throw, which is caught without unregistering the existing owner. This guard was checked in the available app source as read-only evidence; actual host evidence is recorded in TEST_REPORT.md.
- `src/readers/`: independent parsers, content detection, metadata and scientific validation. `index.ts` is the async all-format API; the synchronous local helper covers LAMMPS/XYZ only. Mol*'s PDB tokenizer and CIF tokenizer/parser are reused. CIF model-building code was inspected: its Float32 conformation would lose source precision, so source fields and Mol*'s Float64 crystallographic matrix are used directly instead.
- `src/controller.ts`: discrete frames, timer playback and cleanup, explicit scalar/vector extraction, ranges, stale-request tokens.
- `src/molstar-adapter.ts`: offline Canvas3D context, reusable sphere impostor buffers and a separate grouped cell mesh, picking, categorical/scalar coloring, fit/camera snapshots and disposal. No plugin UI/global Mol* CSS, remote lookup/download, volume streaming or server behavior is instantiated.
- `src/parser-worker.ts` / `worker-client.ts`: bundled local parser worker, cancellation/timeout/error handling; no external worker asset or server.
- `src/config.ts`, `yaml-config.ts`, `paths.ts`: strict schema/YAML parsing and filesystem containment.

`Atom.id` is a string. It is never an array index or a JavaScript Number conversion of a source ID. Frame index is 0-based and separate from string timestep and PDB model number. Coordinates are JS numbers (Float64). Cells contain origin, row vectors `[a,b,c]`, and per-axis boolean/null PBC. The convention is:

`r = origin + sx*a + sy*b + sz*c`

The GPU geometry is display-only Float32; source coordinates are unchanged. Cell bounds from restricted triclinic dumps are corrected by the bounding-bound formula before forming the cell. Data-file bounds are already actual bounds and are never corrected that way. Original image flags and alternate coordinate columns remain properties; unwrapped positions are not shifted again. Units/elements/PBC absent in the source remain unknown. No general XYZ conversion is used anywhere.

CIF raw categories, LAMMPS extra columns/sections and source headers remain metadata. CIF sites are asymmetric/unexpanded; occupancy and disorder are not interpreted as a complete ordered crystal. LAMMPS Bonds remain raw topology, explicitly not interpreted/rendered.

## Rendering and state

One widget owns its parser/controller/Canvas3D. Picking groups map to the current frame's atoms, then store the original ID. Reordered rows therefore do not change selected identity. Property absence/nonnumeric input produces an error before replacing the rendered scene; it never silently selects a different property.

Color mode supports explicitly fixed bounds and labeled per-frame auto bounds. Small in-memory trajectories compute global extrema by default. Disk-backed sources freeze the first displayed reference-frame range, label it as reference-derived (not global extrema), and offer a cancellable explicit full property scan. No unrequested rescaling occurs. A render queue coalesces frame requests while serializing updates. Cameras are fit only initially/reset. A copied schemaVersion=1 fence includes source, frame, camera, map, range and selection. Source files and existing notes are never automatically rewritten.

## Disk-backed access, bounds and lifecycle

`stream-source.ts` opens a regular file read-only, scans 256 KiB chunks and records byte offsets/end/timestep/atom count. UTF-8 byte positions, CRLF, chunk-boundary lines and an unterminated final line are handled. Scanner slices yield after a ~6 ms work budget and at chunk boundaries; numeric parsing is offloaded to a persistent Blob worker. Index limits: 2 GiB/file, 100,000 frames, 1 MiB/line, 16 MiB raw frame, 50,000 atoms/frame. Indexing validates framing, not every numeric property: those are validated by the production reader on frame access. Unsupported general triclinic/compressed/binary formats remain rejected.

First-frame readiness is separate from scan completion. Slider range grows with the completed frame index. Copied nonzero frame state waits for the index before seeking. Async controller requests are serialized for parsing; superseded/closed requests never publish. Playback waits for loading/render completion and does not claim the requested FPS is achieved. IDs remain exact strings and changing sets are warned against the first accessed frame; picking uses current original IDs, never inferred row identity.

A per-source LRU retains at most four parsed frames within 16 MiB estimated storage. Main/worker input bytes and output Float64 position buffers use transfer lists; other per-frame properties remain bounded structured-cloned objects. Columnar zero-copy transport for every property and background prefetch are not yet implemented. The current frame replaces the metadata dataset's frame slot, avoiding an extra permanently pinned first frame. Transient parser/transport/render allocations and GPU memory are outside the estimate, so no hard RSS limit is claimed. Completed index reuse cache is bounded to 16 MiB estimated entries; live source indexes also remain frame-count bounded. Cache is memory-only and cleared at unload.

Before access, ordinary paths undergo lexical validation, realpath containment and stat limits. `external:<24 hex>` is an explicit single-file registration lookup, never an arbitrary absolute path from Markdown. Registration records the chosen path and canonical target; reopening rejects symlink retargets. Source handles and canonical paths are compared by device/inode/size/mtime/ctime before/after frame reads; ordinary replacement/modification invalidates the index, including cached-frame access. Hostile concurrent filesystem mutation is not claimed as a fully hardened security boundary. Growing files require explicit reload; append-only live mode is unsupported.

Other formats remain bounded whole-file readers: 16 MiB, 500 frames, 250,000 atom records. Combined widget dataset reservations are estimated and capped at 128 MiB. Up to four renderers initialize at once. IntersectionObserver tracks the viewport, pauses hidden playback, and releases offscreen renderer/worker/data after 300 ms while preserving view state. Waiting visible widgets retry when a slot becomes free. Reappearance restores frame/camera and reuses completed indexes. Explicit Release viewer stays released until Reload/retry. Closing/unload invalidates requests, aborts range scans, terminates/revokes worker assets, closes file handles, clears timers/observers/listeners and disposes Mol* sphere/cell representations, Canvas3D and assets after pending rendering.

## Deployment

`validate.mjs` runs typecheck/tests/build and records exit codes/hashes. `deploy.mjs` requires existing vault/config, matching plugin ownership and verified artifact hashes. It copies only runtime files and licenses, preserving data.json. Updates back up previous artifacts/settings inside the plugin's `.backups/` subdirectory. Demo deployment creates only `_atomview-tests` content, uses exclusive file creation, chooses new paths on collision and records hashes/ownership. `--plugin-only` keeps existing synthetic files unchanged. The current deployment script supports an existing `.obsidian` config directory; runtime vault access uses Obsidian's filesystem adapter. No activation list, Restricted Mode, themes or workspace settings are edited.

## Actual-app regression lessons

ShapeRepresentation retains GPU geometry ValueCell bindings: pass the previous shape Mesh to MeshBuilder, rather than allocating an independent Mesh on each frame. Source Float64 data is separate and unchanged. Tests must pick the moved atom after frame changes, not merely assert slider labels or pick frame 0.

Obsidian can detach a virtualized code-block root without immediately unloading its Component. Before new renderer creation, recheck connection, visibility and positive dimensions after asynchronous parsing; release the reservation and defer hidden initialization. Existing Canvas3D resize callbacks ignore zero dimensions. Component lifetime and intersection state remain distinct.

## Stability hardening — 2026-10-17

Playback sessions have an epoch in addition to per-seek sequence tokens. Pause invalidates in-flight publications and the previous timer epoch; pause/play while an old read finishes cannot spawn a second playback loop. Reloads abort their preceding load before rebuilding state, wait for previous rendering/handle cleanup, and bind controller callbacks to their own source/ticket. Creation and unindexed-frame waits are abortable. Source disposal is idempotent and concurrent callers await the same cleanup promise.

Worker callbacks check both worker identity and request identity before touching pending state. Malformed position-buffer responses reject the request and terminate the worker; a disposed parser cannot restart. Initial load failures terminate idle parser workers. Cleanup attempts each Mol* resource independently so one failure does not skip all later disposals.

Explicit Release stays released across visibility changes until the user requests Reload. Automatic suspension restores view state. Camera and requested FPS survive reload/release within the widget. Frame captions distinguish loading/failed requests from the last successfully rendered frame. Copy refuses a pending/failed scene; clipboard denial exposes the complete last generated block for manual copy. This fallback mitigates clipboard failure without claiming that physical clipboard readback is universally reliable.

## Desktop Mol* scheduler

Both the bundled parser worker and renderer replace Mol* 5.13.1's legacy scheduler module at build time with `src/molstar-scheduler.ts`. The replacement implements the same immediate/cancel/delay exports using cancellable timer macrotasks; it removes the obsolete IE script-element fallback and persistent message listeners rather than disguising them. Scientific parsers are unchanged. The browser harness uses the identical resolver. Runtime timers are scope-neutral because readers/controllers also execute in workers and independent Node tests; owner-window timer refinement remains a lint warning. `main.js` includes MIT and bundled dependency attribution because community installs do not fetch extra license assets.

Plugin unload disposes registered widgets/resources without detaching workspace leaves. Obsidian owns view removal and restoration.
