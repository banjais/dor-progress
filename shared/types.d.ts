export interface Env {
    TRANSLATION_KV: KVNamespace;
    UPSTASH_REDIS_REST_URL?: string;
    UPSTASH_REDIS_REST_TOKEN?: string;
    GEMINI_API_KEY?: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_API_KEY?: string;
    FIREBASE_AUTH_DOMAIN?: string;
    FIREBASE_APP_ID?: string;
    FIREBASE_MESSAGING_SENDER_ID?: string;
    FIREBASE_STORAGE_BUCKET?: string;
    FIREBASE_MEASUREMENT_ID?: string;
    RECAPTCHA_SITE_KEY?: string;
    ADMIN_SECRET?: string;
    BUILD_ID?: string;
    COMMIT_SHA?: string;
    DEPLOY_TIMESTAMP?: string;
}
