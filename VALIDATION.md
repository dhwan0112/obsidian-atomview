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
