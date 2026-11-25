import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 專案站台在 /onee_world_model/ 之下；本機預覽也沿用同一 base，
// 確保 build 出來的資產路徑與線上一致。
export default defineConfig({
  base: process.env.VITE_BASE ?? '/onee_world_model/',
  plugins: [react()],
  server: { port: 5180, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
});
