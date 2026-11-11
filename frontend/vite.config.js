import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server proxies /api to the HTTPS backend (self-signed cert => secure:false)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: 'https://127.0.0.1:8443', secure: false } } },
})
