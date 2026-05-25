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
