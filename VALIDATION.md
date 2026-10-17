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
- `manifest.json`: `2b4dca2a5f3ad21dbe4c8d94d83d966465715481bcc3f9c1ca2447268a992758`
- `styles.css`: `6306b70f465681bb6b9fd054d086c2fc3d9aefd07df8aaf5125fcc2c09a9e237`
- `THIRD_PARTY_LICENSES.txt`: `871f5f1978c409b6ab62c145654b1f493a893ae49f241cca9b4cb87302c5af0a`
