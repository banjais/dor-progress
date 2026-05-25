// src/lib/branding.ts
import { BrandingEngine } from '../components/BrandingEngine.js';

export const branding: any = {
  // Helper functions
  getAppTitle: () => BrandingEngine.getAppTitle(),
  getFullTitle: (suffix = "") => {
    return BrandingEngine.getFullTitle(suffix);
  },
  getMetaDescription: () => BrandingEngine.getMetaDescription(),

  // Reactive-like access to the config
  get config() { return (BrandingEngine as any).config; }
};

export default branding;