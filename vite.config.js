import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  // Ensures proper asset handling for Web Workers and WASM binaries
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {    
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
