// index.ts

export interface Env {
    // Bindings and Vars from wrangler.toml
    TRANSLATION_KV: KVNamespace;
    // ... other bindings like UPSTASH_REDIS_REST_URL, GEMINI_API_KEY, ADMIN_SECRET etc.
    // (ensure all your KV and secret bindings from wrangler.toml are listed here)
}

export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext
    ): Promise<Response> {
        const url = new URL(request.url);

        // Handle preflight requests for CORS for the translations endpoint
        if (request.method === 'OPTIONS' && url.pathname === '/api/translations') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*', // IMPORTANT: Restrict this to your frontend's domain in production
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        // Route for fetching translations
        if (url.pathname === '/api/translations') {
            try {
                // Retrieve the 'locales' key from TRANSLATION_KV, parsing it as JSON
                const translations = await env.TRANSLATION_KV.get('locales', 'json');

                if (translations) {
                    return new Response(JSON.stringify(translations), {
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*', // IMPORTANT: Restrict this to your frontend's domain in production
                        },
                    });
                } else {
                    return new Response('Translations not found', { status: 404 });
                }
            } catch (error) {
                return new Response(`Error fetching translations: ${error.message}`, { status: 500 });
            }
        }

        // --- Your existing Worker logic goes here for other routes ---
        // Example: A fallback for unmatched routes
        return new Response('Not Found', { status: 404 });
    },
};