import path from "node:path";
/** Replace only Mol*'s pinned legacy scheduler; keep all scientific parsers unchanged. */
export const modernMolstarScheduler = {
  name: "modern-molstar-scheduler",
  setup(build) {
    build.onResolve({ filter: /scheduler\.js$/ }, (args) => {
      const resolved = path.resolve(args.resolveDir, args.path);
      if (
        resolved
          .replaceAll("\\", "/")
          .endsWith("/molstar/lib/mol-task/util/scheduler.js")
      )
        return { path: path.resolve("src/molstar-scheduler.ts") };
    });
  },
};
