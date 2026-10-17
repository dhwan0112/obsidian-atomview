# Bundled libraries

Mol* 5.13.1 (MIT), yaml 2.9.1 (ISC), and Mol*'s transitive runtime dependencies are bundled by esbuild. The build includes a THIRD_PARTY_LICENSES.txt file collected from packages actually used by the main and worker bundles; this file is deployed with the plugin. Mol* project: https://github.com/molstar/molstar. YAML project: https://github.com/eemeli/yaml. Exact complete dependency resolution is in package-lock.json. Obsidian is host-provided and excluded from the bundle. Development-only tools are not installed in the vault.
