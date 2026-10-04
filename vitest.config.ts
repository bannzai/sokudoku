import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// tsconfig.json の paths (@/* → ./src/*) と同じ別名を、vitest のモジュール解決にも渡す
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
