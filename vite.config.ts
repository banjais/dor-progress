import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";

/**
 * Standard root-level Vite configuration.
 * This file automatically picks up .env files in the same directory.
 */
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory (root).
  const env = loadEnv(mode, process.cwd(), "");

  // Priority: 1. VITE_API_BASE_URL in development, 2. VITE_WORKER_BASE in production, 3. fallback localhost
  let apiBaseUrl: string;
  if (mode === "production") {
    apiBaseUrl = env.VITE_WORKER_BASE || "";
  } else {
    apiBaseUrl = env.VITE_API_BASE_URL || "http://localhost:8787";
  }
  if (!apiBaseUrl) console.warn("[Vite] No API base URL set; proxy may fail.");

  // --- Branding Automation ---
  if (mode === "production") {
    try {
      const brandingPath = resolve(__dirname, "public/branding.json");
      const branding = JSON.parse(readFileSync(brandingPath, "utf-8"));

      // Auto-update commit hash and date
      branding.lastCommitHash = execSync("git rev-parse --short HEAD")
        .toString()
        .trim();
      branding.lastUpdate.value = new Date().toISOString().split("T")[0];

      writeFileSync(brandingPath, JSON.stringify(branding, null, 2) + "\n");
      console.log(
        `[Build] Updated branding.json to commit ${branding.lastCommitHash}`,
      );
    } catch (e) {
      console.warn("[Build] Failed to update branding.json metadata:", e);
    }
  }
  // ---------------------------

  return {
    // Define global constants for build-time injection
    define: {
      VITE_WORKER_BASE: JSON.stringify(apiBaseUrl),
      APP_ENV: JSON.stringify(mode),
    },
    plugins: [
      visualizer({
        open: true, // Automatically open the report in your default browser
        filename: "dist/stats.html", // Where to save the report
        gzipSize: true, // Show sizes after gzip compression
        brotliSize: true, // Show sizes after brotli compression
      }),
    ],
    resolve: {
      alias: {
        // Points '@' to the 'src' directory
        "@": resolve(__dirname, "./src"),
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
