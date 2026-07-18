import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  format: "esm",
  target: "node20",
  clean: true,
  external: ["react", "react/jsx-runtime", "ink", "@inkjs/ui"],
  outDir: "dist",
  sourcemap: true,
});
