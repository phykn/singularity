import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8081,
    strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/plan.md', '**/design/*.md'] },
    allowedHosts: ['flyer-affirm-observer.ngrok-free.dev'],
  },
});
