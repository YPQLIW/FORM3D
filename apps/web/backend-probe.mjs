// 로컬 서버(backend) 연결 도우미 — vite.config.ts 에서 사용
import { connect } from 'node:net';

export const BACKEND_PORT = Number(process.env.FORM3D_PORT || 8765);

/** 로컬 서버가 켜져 있는지 짧게 확인 */
function backendUp() {
  return new Promise((resolve) => {
    const s = connect({ host: '127.0.0.1', port: BACKEND_PORT });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(400, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/**
 * 로컬 서버가 꺼져 있을 때 상태 확인(/api/health)에 조용히 "꺼짐"으로 답합니다.
 * (서버 없이 편집기만 쓸 때 터미널·브라우저 콘솔이 연결 오류로 가득 차지 않도록)
 */
export function backendProbe() {
  const mw = (req, res, next) => {
    if (req.method !== 'GET' || !req.url?.startsWith('/api/health')) return next();
    void backendUp().then((up) => {
      if (up) return next();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: false, offline: true }));
    });
  };
  return {
    name: 'form3d-backend-probe',
    configureServer: (server) => void server.middlewares.use(mw),
    configurePreviewServer: (server) => void server.middlewares.use(mw),
  };
}
