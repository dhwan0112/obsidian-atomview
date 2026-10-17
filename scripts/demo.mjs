import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
export async function deployDemo(project, vault) {
  const stamp = Date.now().toString();
  const root = path.join(vault, "_atomview-tests");
  try {
    if ((await fs.lstat(root)).isSymbolicLink())
      throw Error(
        "_atomview-tests is a symlink; explicit path review required",
      );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.mkdir(root, { recursive: true });
  let sub = "fixtures";
  try {
    await fs.lstat(path.join(root, sub));
    sub = `fixtures-${stamp}`;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const dest = path.join(root, sub);
  await fs.mkdir(dest, { recursive: false });
  const files = [];
  for (const entry of await fs.readdir(path.join(project, "fixtures"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const bytes = await fs.readFile(path.join(project, "fixtures", entry.name));
    await fs.writeFile(path.join(dest, entry.name), bytes, { flag: "wx" });
    files.push({
      path: `_atomview-tests/${sub}/${entry.name}`,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const block = (name, extra = "") =>
    '```atomview\nsource: "_atomview-tests/' +
    sub +
    "/" +
    name +
    '"\n' +
    extra +
    "height: 330\n```\n";
  let note = "AtomView Demo.md";
  try {
    await fs.lstat(path.join(root, note));
    note = `AtomView Demo-${stamp}.md`;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const body = `<!-- Generated and owned by obsidian-atomview. Synthetic data only. -->
# AtomView synthetic demo

Open this note in Reading view. Frame indices start at 0; timestep is separate. Drag to rotate, right drag to pan, scroll to zoom. Click an atom for original data. Four viewers may be initialized at once; use Release viewer on an earlier embed then Reload / retry if the limit is reached.

## LAMMPS trajectory: q, nonzero-origin triclinic cell
${block("fe-o-q.lammpstrj", "format: lammps-dump\nframe: 0\nrepresentation: spheres\ncolorBy: q\nshowCell: true\nelementMap:\n  1: Fe\n  2: O\n")}
Use Play / Pause, Next / Previous and the slider. q is fixed across all frames by default. Copy the current view block and paste it into a new synthetic note to restore its frame, camera, selected ID and color range.

## LAMMPS data: atomic style (unknown PBC/units)
${block("iron.data", "format: lammps-data\nelementMap:\n  1: Fe\n")}
## XYZ trajectory
${block("water.xyz")}
## Extended XYZ: vector magnitude
${block("properties.xyz", "colorBy: force\ncomponent: magnitude\n")}
## PDB: two models
${block("models.pdb")}
## coreCIF: asymmetric unit only
${block("fractional.cif")}
Expected Fe coordinate: (2.5, 4, 4.5) angstrom, within 1e-12. No symmetry expansion. Occupancy/disorder are retained as metadata/properties.

## Expected errors
Truncated XYZ:
${block("truncated.xyz")}
Missing file:
${block("missing.xyz")}
Missing property:
${block("water.xyz", "colorBy: q\n")}
Out-of-range frame:
${block("water.xyz", "frame: 999\n")}
Invalid YAML:
\`\`\`atomview
source: [broken
\`\`\`

## Explicit file tab
Use command “AtomView: Open with AtomView” and enter a fixture path above, or right-click a structure file and select Open with AtomView. .data is not automatically associated by default. No external files are allowed.
`;
  await fs.writeFile(path.join(root, note), body, { flag: "wx" });
  files.push({
    path: `_atomview-tests/${note}`,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  });
  const inventory = `atomview-generated-${stamp}.json`;
  await fs.writeFile(
    path.join(root, inventory),
    JSON.stringify(
      {
        owner: "obsidian-atomview",
        generatedAt: new Date().toISOString(),
        files,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return {
    note: path.join(root, note),
    inventory: path.join(root, inventory),
    files,
  };
}
