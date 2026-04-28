import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Vitest 1.x+ automatically loads .env files. 
        // Since Cloudflare uses .dev.vars, we can point to it.
        env: {
            // Fallback defaults for dev testing if .dev.vars is missing
        },
    },
});