import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative base ensures assets resolve correctly on GitHub Pages project sites.
  base: './',
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
