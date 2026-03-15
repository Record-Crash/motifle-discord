import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  envDir: '../',
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/audio': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
    hmr: {
      clientPort: 443,
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
