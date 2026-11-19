import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // shadcn/ui components use the conventional @/ alias (components.json); app code uses #src/.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See src/lib/cn.ts: the registry's bare `cn` import resolves to the approved local helper.
      cn: fileURLToPath(new URL('./src/lib/cn.ts', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: '127.0.0.1',
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
