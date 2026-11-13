import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 渲染层根目录独立，构建产物与主进程一起进 dist/，避免在源码目录留中间文件。
export default defineConfig({
  root: fileURLToPath(new URL('./src/shell', import.meta.url)),
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
});
