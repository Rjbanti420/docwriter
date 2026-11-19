import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The site is served from the custom-domain root; VITE_BASE lets a subpath
// deploy (preview builds, a mirror) reuse the same output.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        guide: fileURLToPath(new URL('./guide.html', import.meta.url)),
        notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
      },
    },
  },
});
