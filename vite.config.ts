import { defineConfig } from "vite";
import fs from "fs";

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  plugins: [
    {
      name: "branding-injection",
      transformIndexHtml(html) {
        try {
          const branding = JSON.parse(fs.readFileSync("./src/branding.json", "utf-8"));
          return html.replace(/<title>.*?<\/title>/, `<title>${branding.app.title}</title>`);
        } catch {
          return html;
        }
      },
    },
  ],
  define: {
    APP_VERSION: JSON.stringify("1.0.178"),
  },
});