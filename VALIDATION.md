# Public preview validation

Executed on Linux, Node 22.22.1, 2026-10-17. Private diagnostic artifacts and research files are excluded.

| Command | Exit | Result |
|---|---:|---|
| `npm ci` | 0 | Clean dependency installation; npm reported zero vulnerabilities |
| `npm run validate` | 0 | Strict typecheck, **44/44** tests, production build |
| `npm run test:core` | 0 | **25/25** core-reader/path checks |
| `npm run test:browser` | 0 | **21** real Mol*/worker checks in a mocked host; HTTP(S) blocked, zero attempts |
| `node scripts/check-bundle.mjs` | 0 | Host-provided modules only at runtime |

The browser test is not an actual Obsidian integration test. Actual Linux Obsidian observations and unverified platforms/scopes are described in TEST_REPORT.md and KNOWN_ISSUES.md. Manifest minimum version is set to the verified desktop baseline, 1.14.4; older versions are not claimed compatible.

## Built runtime SHA256

- `main.js`: `279a0bcaecbe85b1c8204db5135708a20deccf5f2f4249e6c138f655ac1a99a3`
- `manifest.json`: `8ca2d252845068309720c351782b5f7ee63951ebf5693c3ffad4c999b200a85a`
- `styles.css`: `6306b70f465681bb6b9fd054d086c2fc3d9aefd07df8aaf5125fcc2c09a9e237`
- `THIRD_PARTY_LICENSES.txt`: `871f5f1978c409b6ab62c145654b1f493a893ae49f241cca9b4cb87302c5af0a`

## 0.1.2 release metadata repair

Manifest/package version advanced together to 0.1.2 to publish a new non-prerelease event after the directory reported no matching release for 0.1.0. Runtime source is unchanged. Re-ran `npm run validate` (exit 0; 44/44), and `node scripts/check-bundle.mjs` (exit 0). Directory acceptance remains unverified.
Browser regression: `npm run test:browser` exit 0, 21 checks, zero HTTP(S) attempts; mocked Obsidian host only.
An existing empty 0.1.1 release pointed to a commit containing manifest 0.1.0; it was preserved. Final release uses 0.1.2.

## 0.1.3 community review fixes

Executed 2026-10-17 on Linux / Node 22.22.1:

- `npm run lint`: exit 0; zero errors, 29 warnings. Official `eslint-plugin-obsidianmd` 0.4.2 / ESLint 9.39.5. TypeScript pinned to 5.9.3 for ESLint parser compatibility; strict typecheck retained.
- `npm run validate`: exit 0; strict typecheck, **45/45** tests (including scheduler yield/arguments/cancellation) and production build.
- `npm run test:browser`: exit 0; **21** real Mol*/worker checks in mocked Obsidian; zero HTTP(S) attempts. An initial run failed because the mocked host lacked Obsidian's DOM helper; added its owner-document implementation and reran successfully.
- `node scripts/check-bundle.mjs`: exit 0; no script-element scheduler in main/embedded worker and host-only runtime dependencies.
- `npm audit`: exit 0; zero vulnerabilities. The lint tool's transitive Moment dependency is overridden to 2.31.0; not a runtime dependency.
- Actual desktop Obsidian CLI, Research vault: plugin-only deployment with backup, reload reports 0.1.3, synthetic two-atom dump produces WebGL renderer, frame 1 displays, q range [-0.4, 0.2], finite camera. After close settles, zero synthetic tabs/widgets and zero active viewers. The immediate synchronous cleanup probe preceded Obsidian's async close and returned false; a subsequent probe confirmed cleanup.

Remaining review items: scope-neutral timers used by shared Node/worker code, sentence-case suggestions (including scientific acronyms), declarative settings search. Filesystem and clipboard disclosures remain required for the explicitly registered local-file and copy-block features. GitHub artifact attestations and extra release attachments are recommendations. No new actual-host PDB/CIF, offline, long-duration, Windows/macOS or visual screenshot verification was run for 0.1.3. Directory review result remains unverified. No security settings or existing research files were changed.

### 0.1.3 runtime hashes

- `main.js`: `05327b723b94d6e45c2fa751283cefa803a907c07608b9a4455095440ac5cf84`
- `manifest.json`: `035d820efed1f4a034c8ba771349bdfbbf51d91f5653731c798e8b8ec03d0445`
- `styles.css`: `8af072aa08c30c2d7502766db7e3a33dacbd3d600c1d2f5410c32fcc2fe57885`
- `THIRD_PARTY_LICENSES.txt`: `871f5f1978c409b6ab62c145654b1f493a893ae49f241cca9b4cb87302c5af0a`

## 0.1.4 review follow-up

Local checks on Linux / Node 22.22.1, 2026-10-17:

- `npm run validate`: exit 0; official ESLint zero errors / 8 sentence-case warnings, strict typecheck, **46/46** tests and production build. All reported timer, settings-definition, redundant-assertion and unused-import findings addressed without disabling rules.
- `npm run test:browser`: exit 0; **21/21** mocked-host real WebGL/worker checks, zero attempted HTTP(S) requests.
- `node scripts/check-bundle.mjs`: exit 0.
- `GITHUB_REF_NAME=0.1.4 node scripts/check-release.mjs`: exit 0. Prefix `v0.1.4` and mismatched `0.1.3` both rejected with exit 1.
- Actual Linux desktop Obsidian: plugin-only backup/deploy/reload reports 0.1.4; declarative settings exposes the autoData toggle and two existing registration rows; synthetic dump renders with WebGL, displays frame 1 and q range [-0.4, 0.2], camera finite; after close zero synthetic tabs/widgets and zero active viewers. Settings search UI and separate popout/migration GUI were NOT RUN.

New release workflow is pinned to official GitHub Action commits, validates tag/manifest/package versions, runs local-equivalent checks in an isolated public runner, attests only assets it builds, and publishes the three standard Obsidian assets. Workflow execution, attestation verification and directory review remain pending at this commit; no generated attestation is claimed until those commands succeed. Filesystem/clipboard notices describe required capabilities and remain expected. Prior release assets are preserved.
