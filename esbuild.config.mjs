import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

// Same purpose the `builtin-modules` package served: a list of Node.js
// built-in module specifiers to mark as esbuild `external` below, so this
// plugin's dependencies never accidentally get Node builtins bundled into
// main.js (this plugin doesn't import any itself, but marking them
// external is cheap insurance against a future/transitive dependency that
// does). `node:module`'s own `builtinModules` needs no extra dependency
// and, since it's read at build time, always matches whatever Node
// version actually runs the build (this repo's CI/dev environment is
// Node 20+). It only returns bare specifiers ("fs"), so the "node:"
// prefixed form ("node:fs") is added alongside each one to preserve the
// same external coverage the previous list provided for both import
// styles.
const builtins = [
  ...builtinModules,
  ...builtinModules.map((mod) => `node:${mod}`),
];

const banner = `/*
Unified Outliner - built with esbuild.
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
