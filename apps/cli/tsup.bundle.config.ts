import { defineConfig } from "tsup";

// A single self-contained file for the watcher image: every dependency inlined.
export default defineConfig({
  entry: { watcher: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "bundle",
  noExternal: [/.*/],
  splitting: false,
  clean: true,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
