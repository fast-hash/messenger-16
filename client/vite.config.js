import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    // Gолифиллы для Node.js модулей (Buffer, crypto и т.д.), 
    // которые нужны библиотеке Signal
    nodePolyfills({
      protocolImports: true,
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      stream: 'stream-browserify',
    },
  },
});