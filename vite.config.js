import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // chemins relatifs : requis dans la WebView Capacitor
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2000 },
});
