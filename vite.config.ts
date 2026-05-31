import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  const apiBaseUrl = env.VITE_WORKER_BASE || "http://localhost:8787";

  // ⚠️ SAFE: do NOT mutate repo files in production builds
  if (mode === "production") {
    try {
      const brandingPath = resolve(__dirname, "public/branding.json");
      const branding = JSON.parse(readFileSync(brandingPath, "utf-8"));

      branding.lastCommitHash = execSync("git rev-parse --short HEAD")
        .toString()
        .trim();

      branding.lastUpdate.value = new Date().toISOString().split("T")[0];

      // safer: write to dist instead of source
      const distBrandingPath = resolve(__dirname, "dist/branding.json");
      writeFileSync(distBrandingPath, JSON.stringify(branding, null, 2));

      console.log(`[Build] branding.json written to dist`);
    } catch (e) {
      console.warn("[Build] branding update failed:", e);
    }
  }

  return {
    define: {
      VITE_WORKER_BASE: JSON.stringify(apiBaseUrl),
      APP_ENV: JSON.stringify(mode),
    },

    plugins: [
      visualizer({
        open: true,
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
    ],

    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
        "@shared": resolve(__dirname, "./shared")
      },
    },

    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "vendor-jspdf": ["jspdf", "jspdf-autotable"],
          },
        },
      },
    },

    server: {
      proxy: {
        "/api": {
          target: apiBaseUrl,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});