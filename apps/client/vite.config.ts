import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare()],
  define: {
    // Bake the test-hooks flag in at build time so the prod bundle contains no
    // `__talad` at all (the guard is statically false and dead-code eliminated).
    'import.meta.env.VITE_TEST_HOOKS': JSON.stringify(process.env.VITE_TEST_HOOKS ?? ''),
  },
});
