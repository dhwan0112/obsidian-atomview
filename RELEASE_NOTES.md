AtomView 0.1.4

- Bind viewer/controller/parser timers to their owner window while preserving worker and standalone-reader execution.
- Make the .data setting searchable through declarative settings; retain per-file revoke actions.
- Remove redundant assertions and unused imports.
- Build, test and attest runtime assets in GitHub Actions; publish only main.js, manifest.json and styles.css. License notices remain embedded in main.js.

Filesystem notices remain expected: registered external files are read-only and explicit. Clipboard access only writes the requested view block. Community-directory acceptance and cross-platform behavior are not implied by this release.
