import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    host: '0.0.0.0',
    allowedHosts: ['sinkot.in', 'localhost', '127.0.0.1', '3.111.242.49'],
    proxy: {
      '/api': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(`[PROXY ERROR] ${req.url}:`, err.message)
          })
        },
      },
      '/ws': {
        target: 'http://localhost:8085',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

