import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const appRoot = import.meta.dirname;

export default defineConfig({
  root: appRoot,
  base: './',
  publicDir: false,
  plugins: [react(), {
    name: 'android-brand-asset',
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'danmutalk-mark.svg',
        source: await readFile(resolve(appRoot, '../desktop/public/danmutalk-mark.svg')),
      });
    },
  }],
  define: {
    'import.meta.env.VITE_APP_TARGET': JSON.stringify('android'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
