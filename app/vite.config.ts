import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const appRoot = dirname(fileURLToPath(import.meta.url));

/**
 * 網站程式放在 app/，建置輸出直接寫到倉庫根目錄。
 *
 * 原因：GitHub Pages 目前的來源是「分支 main /（root）」，因此送出到 main 的根目錄
 * 必須就是可運作的靜態網站（index.html、assets/、model-data/）。這樣 DSH 只要
 * 匯出 → 建置 → 提交 → 推送，Pages 就會更新，不需要任何 CI 權限或額外設定。
 * 網站程式與公開資料仍然全部由本機產生；GitHub 端不做任何資料抓取。
 */
export default defineConfig({
  root: appRoot,
  base: process.env.VITE_BASE ?? '/onee_world_model/',
  plugins: [react()],
  publicDir: resolve(appRoot, 'public'),
  server: { port: 5180, host: true },
  preview: { port: 4173, host: true },
  build: {
    outDir: resolve(appRoot, '..'),
    emptyOutDir: false,
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
