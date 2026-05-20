import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/",                    // Good for Firebase
  publicDir: "public",

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  define: {
    WORKER_BASE: JSON.stringify(process.env.WORKER_BASE || "https://dor-progress.web.app"),
    // Optional: Help with environment detection
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "1.0.0"),
  },

  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
    chunkSizeWarningLimit: 1500,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/app-check"],
          vendor: ["zod"],
        },
      },
    },
  },

  assetsInclude: ["**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.svg", "**/*.pdf"],

  server: {
    fs: {
      strict: false,
    },
    // Optional: Better for PWA development
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  },

  // Optional but useful
  preview: {
    port: 4173,
  },
});