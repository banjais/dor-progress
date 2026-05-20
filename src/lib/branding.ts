// src/lib/branding.ts
import brandingRaw from '../../public/branding.json' assert { type: 'json' };

export const branding = {
  ...brandingRaw,

  // Helper functions
  getAppTitle: () => brandingRaw.app.title,
  getFullTitle: (suffix = "") => {
    return suffix ? `${brandingRaw.app.title} | ${suffix}` : brandingRaw.app.title;
  },

  getMetaDescription: () => brandingRaw.app.subtitle || "Department of Roads Progress Monitoring",
};

export default branding;