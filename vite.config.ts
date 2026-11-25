import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    copyPublicDir: !isSsrBuild,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The preview proxy serves the app from a dynamic *.e2b.app host,
    // so Vite must not reject requests whose Origin does not match.
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: `http://127.0.0.1:${process.env.PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
}));
