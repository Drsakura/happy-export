import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5300,
    proxy: {
      // SKU 能力代理（过渡期）：前端统一以 /api/sku/* 访问，避免跨域与端口耦合。
      // 后端正式合并（P1）完成后可直接删除本段。
      '/api/sku': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sku/, '/api')
      },
      '/product-images': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:4300',
        changeOrigin: true
      }
    }
  }
})
