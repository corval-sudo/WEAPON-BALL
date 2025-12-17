import { defineConfig } from "vite";

export default defineConfig({
  server: {
    fs: {
      // Allow Vite dev server to read files from the repo root (parent directory)
      allow: [".."],
    },
  },
});