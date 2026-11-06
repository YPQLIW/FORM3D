import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { BACKEND_PORT, backendProbe } from './backend-probe.mjs';

// 로컬 서버(backend, 127.0.0.1:8765)로 /api 요청과 편집기 연결(WebSocket)을 전달
const backend = { target: `http://127.0.0.1:${BACKEND_PORT}`, ws: true };

// Tauri(Phase 7)에서도 그대로 사용할 수 있도록 고정 포트를 사용합니다.
export default defineConfig({
  plugins: [backendProbe(), react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy: { '/api': backend } },
  preview: { proxy: { '/api': backend } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
