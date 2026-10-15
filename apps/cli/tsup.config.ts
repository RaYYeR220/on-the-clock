import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  clean: true,
  target: "node22",
  platform: "node",
  banner: { js: "" },
});
