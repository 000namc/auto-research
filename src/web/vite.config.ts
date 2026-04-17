import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// CLAUDE.md "Webapp 접근" rules: bind to 127.0.0.1 only.
// network_mode: host in compose means this binds directly to the host loopback;
// the SSH tunnel forwards localhost:5173 to the user's Mac.
// /api and /ws proxy to the FastAPI app on the same host loopback.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
