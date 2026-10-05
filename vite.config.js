import { defineConfig } from 'vite';

const backend = `127.0.0.1:${process.env.PORT || 3001}`;

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Three is lazy-loaded with the battlefield. Keep its stable runtime
        // separate from frequently edited game rendering code so repeat loads
        // can reuse the browser cache without fetching the whole scene again.
        manualChunks(id) {
          if (id.includes('/node_modules/three/build/three.core.js')) return 'three-core';
          if (id.includes('/node_modules/three/')) return 'three-runtime';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': `http://${backend}`,
      '/ws': { target: `ws://${backend}`, ws: true },
    },
  },
});
