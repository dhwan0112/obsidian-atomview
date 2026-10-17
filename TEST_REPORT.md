# Validation scope

The first public preview is based on a locally validated desktop build. Its core scientific and lifecycle tests are included here and can run without an Obsidian vault.

## Reproducible checks

```sh
npm ci
npm run validate
npx playwright install chromium
npm run test:browser
node scripts/check-bundle.mjs
```

- Strict TypeScript checking, unit/scientific tests and production bundling are run by `validate`.
- Unit coverage includes independent triclinic expectations, exact IDs, format errors, cells/properties, path containment, source changes, cancellation and delayed playback/worker races.
- The browser harness uses real Mol* WebGL and the bundled parser worker in a **mocked Obsidian host**. It tests all five format families, picking, copied state, scrolling embeds, concurrent reload/seek, manual release, failed rendering, clipboard denial and cleanup. HTTP(S) is blocked during the test.
- Bundle checking verifies host runtime imports; it is not a real-app test.

## Actual host observations and boundaries

Synthetic file tabs and Reading-view embeds were checked in Linux desktop Obsidian 1.14.4, including PDB/CIF, picking, playback, camera/FPS restoration, repeated reload/close and resource counters. A separate short local playback sample covered roughly 30 seconds; it is not an hours-long stability guarantee. Private input files, paths and host diagnostic artifacts are intentionally excluded from this repository.

Windows/macOS, mobile, advanced Live Preview, total Electron/GPU peak memory, boundary-size stress and actual full-app offline mode have not been verified. The isolated renderer's blocked-network result must not be represented as a full-app offline test. Physical OS clipboard readback remains a validation gap; manual-copy fallback is tested. No ASE/OVITO cross-validation is claimed.

Public-check outcomes for this snapshot are recorded in VALIDATION.md after the commands are executed. No unrun checks should be reported as passing.

## 0.1.3 release regression

See VALIDATION.md for the exact release checks and boundaries. Official lint: zero errors / 29 warnings; unit tests 45/45; browser checks 21/21; bundle and audit passed. Actual Obsidian smoke confirmed synthetic dump renderer, frame movement, q range and eventual tab/widget cleanup. New cross-platform and extended-duration verification NOT RUN; community review acceptance NOT VERIFIED.

## 0.1.4

See VALIDATION.md for exact checks. Local 46/46 tests and 21/21 browser checks passed, lint zero errors (8 sentence-case warnings). Owner-window scheduling/cancellation regression passed. Actual Obsidian synthetic render/q/frame/cleanup and declarative definitions verified via CLI. Settings search UI, separate popout GUI, cross-platform and long-duration validation NOT RUN. Attested release workflow results are recorded separately when run.
