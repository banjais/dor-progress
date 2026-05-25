export class BrandingEngine {
  private static config: any = null;

  /**
   * Helper functions for branding data access
   */
  static getAppTitle = () => BrandingEngine.config?.app?.title || "DoR Progress";
  static getFullTitle = (suffix = "") => {
    const title = BrandingEngine.getAppTitle();
    return suffix ? `${title} | ${suffix}` : title;
  };
  static getMetaDescription = () => BrandingEngine.config?.app?.subtitle || "Department of Roads Progress Monitoring";

  /**
   * Applies branding to the DOM
   */
  static async apply() {
    console.log("💎 Applying Dynamic Branding Engine...");

    // Fetch branding at runtime
    const response = await fetch('/branding.json');
    if (!response.ok) throw new Error("Failed to load branding configuration.");

    const branding = await response.json();
    BrandingEngine.config = branding;

    // 1. Update Global Titles
    document.title = branding.app?.title || "DoR Progress";

    // 2. Update Header & Branding Sections
    const mappings = {
      "header-app-name": branding.app?.title,
      "h-govt": branding.organization?.government || "",
      "h-min": branding.organization?.ministry || "",
      "h-city": branding.organization?.location || "",
      "h-report": branding.report?.title || "",
      "splash-gov-text": branding.organization?.government || "",
      "splash-dept-text": branding.organization?.department || "",
      "footer-copy": `&copy; ${new Date().getFullYear()} ${branding.organization?.department || "DoR"}. All rights Reserved.`,
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
      const label = branding.lastUpdate?.label || "Last Updated";
      updateLabel.innerText = `${label}: ${branding.lastUpdate?.value || 'N/A'}`;
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