/// <reference types="@cloudflare/workers-types" />
export interface Env {

    TRANSLATION_KV: KVNamespace;
    // Add other bindings here if they exist in wrangler.toml
}
