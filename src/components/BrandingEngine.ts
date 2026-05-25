import { z } from "zod";

const DEFAULT_BRANDING_VALUES = {
  app: {
    title: "DoR – सडक विभाग",
    fullName: "DoR Progress Dashboard"
  },
  seo: {
    description: "Official Department of Roads Weekly Progress & Statistics Dashboard.",
    ogImage: "/logo.png"
  },
  colors: {
    primary: "#1a5c3a",
    backgroundDark: "#0b0f1a",
    good: "#4ade80",
    stable: "#facc15",
    critical: "#f87171"
  },
  organization: {
    government: "Government of Nepal",
    ministry: "Ministry of Infrastructure Development",
    location: "Chakupat, Lalitpur",
    department: "Department of Roads"
  },
  report: {
    title: "DoR Progress Report (Weekly)"
  },
  lastUpdate: {
    value: ""
  }
};

const BrandingSchema = z.object({
  app: z.object({
    title: z.string().optional(),
    fullName: z.string().optional(),
  }).optional(),
  seo: z.object({
    description: z.string().optional(),
    ogImage: z.string().optional(),
  }).optional(),
  colors: z.object({
    primary: z.string().optional(),
    backgroundDark: z.string().optional(),
    good: z.string().optional(),
    stable: z.string().optional(),
    critical: z.string().optional(),
  }).optional(),
  organization: z.object({
    government: z.string().optional(),
    ministry: z.string().optional(),
    location: z.string().optional(),
    department: z.string().optional(),
  }).optional(),
  report: z.object({
    title: z.string().optional(),
  }).optional(),
  lastUpdate: z.object({
    value: z.string().optional(),
  }).optional(),
  lastCommitHash: z.string().optional(),
  version: z.string().optional(),
}).deepPartial(); // Allow partial objects and fields to be optional

export class BrandingEngine {
  private static _listeners = new Set<(config: z.infer<typeof BrandingSchema>) => void>();
  
  private static _config: z.infer<typeof BrandingSchema> = new Proxy({ ...DEFAULT_BRANDING_VALUES }, {
    set: (target, prop, value) => {
      (target as any)[prop] = value;
      this.notify();
      return true;
    }
  });

  private static pendingFaviconUrl: string | null = null;
  private static pendingThemeColor: string = DEFAULT_BRANDING_VALUES.colors.primary;
  private static pendingDarkColor: string = DEFAULT_BRANDING_VALUES.colors.backgroundDark;

  /**
   * Subscribes to branding changes.
   * @param listener Callback function receiving the updated config
   * @returns Unsubscribe function
   */
  static subscribe(listener: (config: z.infer<typeof BrandingSchema>) => void) {
    this._listeners.add(listener);
    // Perform initial sync for DOM updates if this is the first listener
    if (this._listeners.size === 1) this.updateDOM(this._config);
    else listener(this._config);
    
    return () => this._listeners.delete(listener);
  }

  private static notify() {
    this._listeners.forEach(listener => listener(this._config));
  }

  static get config() {
    return this._config;
  }

  static getAppTitle() {
    return this._config.app?.title || DEFAULT_BRANDING_VALUES.app.title;
  }

  static getFullTitle(suffix = "") {
    const base = this._config.app?.fullName || DEFAULT_BRANDING_VALUES.app.fullName;
    return suffix ? `${base} | ${suffix}` : base;
  }

  static getMetaDescription() {
    return this._config.seo?.description || DEFAULT_BRANDING_VALUES.seo.description;
  }

  /**
   * Fetches the branding.json configuration and updates the DOM, 
   * page title, and meta tags accordingly.
   */
  static async apply() {
    let branding: z.infer<typeof BrandingSchema> = DEFAULT_BRANDING_VALUES;

    try {
      const response = await fetch('/branding.json');
      if (response.ok) {
        const fetchedRaw = await response.json();
        const parsed = BrandingSchema.safeParse(fetchedRaw);
        if (parsed.success) {
          // Deep merge the fetched valid data with defaults
          branding = {
            ...DEFAULT_BRANDING_VALUES,
            ...parsed.data,
            app: { ...DEFAULT_BRANDING_VALUES.app, ...parsed.data.app },
            seo: { ...DEFAULT_BRANDING_VALUES.seo, ...parsed.data.seo },
            colors: { ...DEFAULT_BRANDING_VALUES.colors, ...parsed.data.colors },
            organization: { ...DEFAULT_BRANDING_VALUES.organization, ...parsed.data.organization },
            report: { ...DEFAULT_BRANDING_VALUES.report, ...parsed.data.report },
            lastUpdate: { ...DEFAULT_BRANDING_VALUES.lastUpdate, ...parsed.data.lastUpdate }
          };
        } else {
          console.warn('[BrandingEngine] branding.json validation failed, using defaults:', parsed.error.format());
          branding = DEFAULT_BRANDING_VALUES; // Fallback to full defaults
        }
      }

      // Updating the proxy automatically triggers subscribers (including updateDOM)
      Object.assign(this._config, branding);
    } catch (e) {
      console.warn('[BrandingEngine] Failed to fetch branding.json, using defaults:', e);
    }
  }

  private static updateDOM(branding: z.infer<typeof BrandingSchema>) {
    // 1. App Identity
    if (branding.app?.title) document.title = branding.app.title;
    this.setText('.header-app-name', branding.app?.fullName);

    // 2. SEO & Social Meta
    this.updateMeta('description', branding.seo?.description);
    this.updateMeta('og:title', branding.app?.title, true);
    this.updateMeta('og:description', branding.seo?.description, true);
    this.updateMeta('og:image', branding.seo?.ogImage || '/logo.png', true);
    this.updateMeta('og:url', typeof window !== 'undefined' ? window.location.origin : '', true);
    this.updateMeta('twitter:card', 'summary_large_image');
    this.pendingFaviconUrl = branding.seo?.ogImage || '/logo.png';
    this.preLoadImage(this.pendingFaviconUrl);

    // 3. Theme Colors
    if (branding.colors?.primary) this.pendingThemeColor = branding.colors.primary;
    if (branding.colors?.backgroundDark) this.pendingDarkColor = branding.colors.backgroundDark;
    
    // Sync Chart Variables
    const root = document.documentElement;
    if (branding.colors?.good) root.style.setProperty('--good', branding.colors.good);
    if (branding.colors?.stable) root.style.setProperty('--stable', branding.colors.stable);
    if (branding.colors?.critical) root.style.setProperty('--critical', branding.colors.critical);

    // 4. UI Elements & Branding Strings
    this.setText('#h-govt', branding.organization?.government);
      this.setText('#h-min', branding.organization?.ministry);
      this.setText('#h-city', branding.organization?.location);
      this.setText('#h-report', branding.report?.title);
      
      this.setText('#splash-gov-text', branding.organization?.government);
      this.setText('#splash-dept-text', branding.organization?.department);

      // 5. Update last update value in the UI
      if (branding.lastUpdate?.value) {
        this.setText('#last-update', `अपडेट मिति: ${branding.lastUpdate.value}`);
    }
  }

  /**
   * Applies the favicon update that was queued during initialization.
   */
  public static finalizeFavicon() {
    if (this.pendingFaviconUrl) this.updateFavicon(this.pendingFaviconUrl);
  }

  /**
   * Returns the current branded primary color.
   */
  public static getBrandedColor(): string {
    return this.pendingThemeColor;
  }

  /**
   * Returns the current branded dark mode background color.
   */
  public static getBrandedDarkColor(): string {
    return this.pendingDarkColor;
  }

  /**
   * Applies the theme color update that was queued during initialization.
   */
  public static finalizeThemeColor() {
    this.updateMeta('theme-color', this.pendingThemeColor, false, '(prefers-color-scheme: light)');
    this.updateMeta('theme-color', this.pendingDarkColor, false, '(prefers-color-scheme: dark)');

    // Directly apply the branded primary color to the CSS variable on the document root
    document.documentElement.style.setProperty('--primary', this.pendingThemeColor);
  }

  private static updateMeta(nameOrProp: string, content: string | undefined, isProperty = false, media?: string) {
    if (!content) return;
    const attr = isProperty ? 'property' : 'name';
    const selector = media 
        ? `meta[${attr}="${nameOrProp}"][media="${media}"]` 
        : `meta[${attr}="${nameOrProp}"]`;
    
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, nameOrProp);
      if (media) el.setAttribute('media', media);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  private static updateFavicon(url: string) {
    const links = document.querySelectorAll("link[rel*='icon']");
    links.forEach(link => {
      (link as HTMLLinkElement).href = url;
    });
    // Also update apple-touch-icon for iOS
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
    if (appleIcon) appleIcon.href = url;
  }

  private static preLoadImage(url: string) {
    const img = new Image();
    img.src = url;
  }

  private static setText(selector: string, text: string | undefined) {
    if (!text) return;
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => {
        if (el instanceof HTMLElement) el.textContent = text;
    });
  }
}

// Initialize default DOM tracking
BrandingEngine.subscribe(() => {});