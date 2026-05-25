/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKER_BASE: string;
  readonly VITE_FIREBASE_URL: string;
  readonly VITE_BUILD_ID: string;
  readonly VITE_COMMIT_SHA: string;
  readonly VITE_APP_ENV: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Interface matching the branding.json structure */
export interface Branding {
  version: string;
  app: {
    name: string;
    fullName: string;
    shortName: string;
    title: string;
    subtitle: string;
    tagline: string;
  };
  organization: {
    government: string;
    ministry: string;
    department: string;
    location: string;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
  lastUpdate: { value: string };
  lastCommitHash: string;
}

declare module "*/branding.json" {
  const value: Branding;
  export default value;
}

declare const WORKER_BASE: string;
declare const VITE_WORKER_BASE: string;
declare const VITE_FIREBASE_URL: string;
declare const BUILD_ID: string;
declare const COMMIT_SHA: string;
declare const APP_ENV: "development" | "production" | "test";
declare const APP_VERSION: string;
