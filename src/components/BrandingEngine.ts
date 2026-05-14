import branding from "../branding.json" with { type: "json" };

export class BrandingEngine {
  static apply() {
    console.log("💎 Applying Dynamic Branding Engine...");

    const { app } = branding;

    // 1. Update Global Titles
    document.title = app.title;

    // 2. Update Header & Branding Sections
    const mappings = {
      "header-app-name": app.title,
      "h-govt": app.government,
      "h-min": app.ministry,
      "h-city": app.location,
      "h-report": app.reportTitle,
      "splash-gov-text": app.government,
      "splash-dept-text": app.department,
      "footer-copy": `&copy; ${new Date().getFullYear()} ${app.department}. All rights Reserved.`,
    };

    Object.entries(mappings).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) {
        if (id === "footer-copy") el.innerHTML = value;
        else el.innerText = value;
      }
    });

    // 3. Update Last Updated Date
    const updateLabel = document.getElementById("last-update-label");
    if (updateLabel) {
      updateLabel.innerText = `${branding.lastUpdate.label}: ${branding.lastUpdate.value}`;
    }

    // 4. Inject Dynamic Colors from branding.json to CSS variables
    if (branding.colors) {
      document.documentElement.style.setProperty(
        "--primary",
        branding.colors.primary,
      );
      document.documentElement.style.setProperty(
        "--primary-dark",
        branding.colors.secondary,
      );
    }
  }
}
