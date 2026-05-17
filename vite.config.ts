import { defineConfig, loadEnv } from "vite";
import legacy from "@vitejs/plugin-legacy";
import fs from "fs";
import path from "path";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    server: {
      port: 3000,
      open: true,
    },
    build: {
      reportCompressedSize: false, // Speeds up build time
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["firebase/app", "firebase/app-check", "zod", "jose"],
          },
        },
      },
    },
    plugins: [
      legacy({
        targets: ["defaults", "not IE 11"],
      }),
      {
        name: "branding-injection",
        transformIndexHtml(html) {
          try {
            const brandingPath = path.resolve(__dirname, "./config/branding.json");
            if (fs.existsSync(brandingPath)) {
              const branding = JSON.parse(fs.readFileSync(brandingPath, "utf-8"));
              return html
                .replace(/<title>.*?<\/title>/, `<title>${branding.app.title}</title>`)
                .replace("<!-- APP_VERSION -->", `v${pkg.version}`);
          }
          return html;
          } catch {
            return html;
          }
        },
      },
    ],
    define: {
      APP_VERSION: JSON.stringify(pkg.version),
      WORKER_BASE: JSON.stringify(env.VITE_API_BASE_URL || ""),
      BUILD_ID: JSON.stringify(env.VITE_BUILD_ID || ""),
      COMMIT_SHA: JSON.stringify(env.VITE_COMMIT_SHA || ""),
      APP_ENV: JSON.stringify(env.VITE_APP_ENV || "production"),
    },
  };
});