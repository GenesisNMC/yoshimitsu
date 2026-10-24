import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const crossOriginHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  base: '/',
  plugins: [
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    host: '0.0.0.0',
    headers: crossOriginHeaders,
  },
  preview: {
    host: '0.0.0.0',
    headers: crossOriginHeaders,
  },
});
