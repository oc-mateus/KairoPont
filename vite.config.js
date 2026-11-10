import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createSecurityPolicy } from './scripts/security-policy.mjs';

const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig(({ mode }) => ({
  base,
  plugins: [react(), {
    name: 'production-security-policy',
    apply: 'build',
    transformIndexHtml() {
      const env = loadEnv(mode, process.cwd(), 'VITE_');
      return [{ tag: 'meta', attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: createSecurityPolicy(env.VITE_SUPABASE_URL),
      }, injectTo: 'head-prepend' }];
    },
  }],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'framework';
          if (id.includes('/@supabase/')) return 'supabase';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
}));
