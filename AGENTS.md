# AtomView development rules

- Preserve Float64 source coordinates and string atom IDs. Cell vectors are rows a,b,c; Cartesian = origin + sx*a + sy*b + sz*c.
- Unknown elements/units/PBC remain unknown. Never infer LAMMPS elements from type numbers/masses or invent bonds. Preserve source properties and metadata.
- Use synthetic fixtures for public tests. Never commit real research data, device-specific paths/settings, diagnostic logs or private reports.
- Ordinary sources stay vault-contained. External access requires an explicitly registered single file. Never overwrite original structure files or notes.
- Development deployment writes only to an existing vault's owned plugins/atomview and _atomview-tests directories. Preserve settings and backup prior builds. Never alter security settings or unrelated plugins.
- Pause invalidates pending publications and playback epochs. Cancelled loads/workers must not publish stale results or resurrect resources. Dispose must be idempotent.
- Reuse Mol* geometry ValueCells; hidden viewports release slots and restore state. Failed renders must not claim to display a new frame.
- Run npm run validate, npm run test:browser and node scripts/check-bundle.mjs before release. Mocked browser checks are not actual Obsidian integration tests.
- Test on actual desktop Obsidian separately using synthetic notes; document OS/version and limitations. Never claim hours-long stability or total GPU memory bounds from short samples.
- Commits use only the maintainer's explicitly configured Git author/committer identity. Do not add assistant co-author attribution.
