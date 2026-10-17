# Known issues and validation limits

- **Cross-computer external sources:** registrations refer to selected absolute local paths. Re-registering on another computer creates a new source ID/view and does not automatically repair an existing external-ID embed. Vault-relative sources work when the referenced files are available at the same relative paths.
- **Clipboard:** physical OS clipboard readback has not been verified consistently. A complete last-generated block remains available for manual copy if clipboard permission is denied.
- **Platform:** actual host validation currently covers Linux Obsidian 1.14.4. Windows/macOS execution and advanced Live Preview workflows are not yet verified. Mobile is unsupported.
- **Streaming:** only uncompressed text LAMMPS dumps use lazy disk reads. Indexes are memory-only; growing files require reload. Indexing checks framing, while numeric values and IDs are validated on frame access. A complete index does not mean every atom value was validated.
- **Performance:** frame-cache limits are storage estimates, not hard process/GPU memory limits. Hours-long sessions, upper-bound stress and many simultaneous large viewers remain unverified. Large absolute-coordinate rendering precision needs additional validation.
- **Format semantics:** CIF is an unexpanded asymmetric unit; occupancy/disorder are retained. mmCIF shows the first model. No inferred bonds, symmetry expansion or physical MD time is invented. See FORMAT_SUPPORT.md.

Regression coverage includes pause/restart races, stale worker messages, close during loading, source replacement, manual release, reload/seek races, PDB/CIF viewport starvation, single-atom camera fit, moved-frame GPU picking and truthful failed-frame/copy state. See TEST_REPORT.md for validation scope.
