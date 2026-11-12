import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    {
      // Mirror esbuild's `.md: text` loader so prompt files import as strings.
      name: "md-as-text",
      transform(code, id) {
        if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
      },
    },
  ],
  resolve: {
    alias: {
      // Pure modules are tested in Node; anything that touches Obsidian gets this stub.
      obsidian: fileURLToPath(new URL("./test/stubs/obsidian.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
