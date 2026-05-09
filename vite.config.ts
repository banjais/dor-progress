import { defineConfig } from "vite";
import checker from "vite-plugin-checker";
import path from "path";
import fs from "fs";

export default defineConfig({
  root: ".",
  build: {
    outDir: ".build",
    emptyOutDir: true,
rollupOptions: {
       input: {
         main: path.resolve(__dirname, "index.html"),
       },
     },
  },
  server: {
    port: 3000,
    open: true,
  },
  plugins: [
    {
      name: "branding-injection",
      transformIndexHtml(html) {
        const branding = JSON.parse(
          fs.readFileSync("./src/branding.json", "utf-8"),
        );
        return html
          .replace(
            /<title>.*?<\/title>/,
            `<title>${branding.app.title}</title>`,
          )
          .replace(
            /id="main-title">.*?<\/span>/,
            `id="main-title">${branding.app.title}</span>`,
          )
          .replace(
            /id="h-govt">.*?<\/h4>/,
            `id="h-govt">${branding.app.government}</h4>`,
          )
          .replace(
            /id="h-min">.*?<\/h4>/,
            `id="h-min">${branding.app.ministry}</h4>`,
          )
          .replace(
            /id="h-dept">.*?<\/h2>/,
            `id="h-dept">${branding.app.department}</h2>`,
          )
          .replace(
            /id="h-city">.*?<\/h4>/,
            `id="h-city">${branding.app.location}</h4>`,
          )
          .replace(/id="h-report".*?>.*?<\/h4>/s, (match) =>
            match.replace(/>.*?<\/h4>/s, `>${branding.app.reportTitle}</h4>`),
          );
      },
    },
  ],
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
      process.env.API_BASE_URL || "https://dor-progress.banjays.workers.dev",
    ),
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(new Date().toISOString()),
    "import.meta.env.VITE_COMMIT_SHA": JSON.stringify(
      process.env.COMMIT_SHA || process.env.GITHUB_SHA || "production",
    ),
    "import.meta.env.VITE_APP_ENV": JSON.stringify(process.env.VITE_APP_ENV || "production"),
    WORKER_BASE: JSON.stringify(process.env.API_BASE_URL || "https://dor-progress.banjays.workers.dev"),
    APP_ENV: JSON.stringify(process.env.VITE_APP_ENV || "production"),
    APP_VERSION: JSON.stringify("1.0.131"),
  },
});
