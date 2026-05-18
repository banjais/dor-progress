import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/",

  publicDir: "public",

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  define: {
    WORKER_BASE: JSON.stringify(process.env.WORKER_BASE || "https://dor-progress.web.app"),
  },

  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2018",
    chunkSizeWarningLimit: 1500,
  },

  assetsInclude: ["**/*.png", "**/*.jpg", "**/*.pdf"],

  server: {
    fs: {
      strict: false,
    },
  },
});