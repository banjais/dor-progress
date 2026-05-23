import branding from "../../public/branding.json" with { type: "json" };

export class BrandingEngine { // No citation needed, this is internal code.
  static apply() {
    console.log("💎 Applying Dynamic Branding Engine...");

    // 1. Update Global Titles
    document.title = branding.app.title;

    // 2. Update Header & Branding Sections
    const mappings = {
      "header-app-name": branding.app.title,
      "h-govt": branding.organization.government,
      "h-min": branding.organization.ministry,
      "h-city": branding.organization.location,
      "h-report": branding.report.title,
      "splash-gov-text": branding.organization.government,
      "splash-dept-text": branding.organization.department,
      "footer-copy": `&copy; ${new Date().getFullYear()} ${branding.organization.department}. All rights Reserved.`,
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