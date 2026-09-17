import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5300,
    proxy: {
      // 产品目录（SKU）与产品图现在都由 happy 后端（4300）提供 —— 独立 SKU 服务已并入，
      // 3300 不再存在。前缀与路径保持原样（/api/sku/groups → 4300/api/sku/groups），
      // 前端代码零改动。写操作要记「上传者 / 调价人」，必须走 4300 才有人可记。
      '/api/sku': {
        target: 'http://127.0.0.1:4300',
        changeOrigin: true
      },
      '/product-images': {
        target: 'http://127.0.0.1:4300',
        changeOrigin: true
      },
      '/api': {
        target: 'http://127.0.0.1:4300',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        /* 把「很少变」的第三方库拆成独立 chunk：
         *   1) 首屏只需再下载业务代码，React 这些体积大头可以长期缓存，发版不用重新下载；
         *   2) 配合页面懒加载，首屏体积能降一大截。
         * 只分两组，不按库细分 —— 拆太碎会变成一堆小请求，反而更慢。 */
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-axios': ['axios']
        }
      }
    },
    /* 业务代码已按页面拆分，单块都不大；阈值放宽，免得控制台刷一堆体积警告 */
    chunkSizeWarningLimit: 700
  }
})
