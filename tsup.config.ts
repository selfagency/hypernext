import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  target: "node24",
  clean: true,
  outDir: "dist",
  sourcemap: true,
});
