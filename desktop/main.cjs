/**
 * FORM3D 설치형 프로그램 (Electron)
 *
 * - 프로그램 안에 든 Python으로 로컬 서버(backend)를 켜고, 서버가 제공하는 편집기 화면을 창에 띄웁니다.
 * - 창을 닫으면 서버도 함께 끕니다.
 * - 새 버전이 GitHub Releases에 올라오면 내려받은 뒤 "지금 다시 시작" 여부를 묻습니다.
 * - 프로젝트·AI 키·설정은 지금처럼 문서\FORM3D 에 저장됩니다 (프로그램을 지워도 남음).
 */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.FORM3D_PORT || 8765);
const URL = `http://127.0.0.1:${PORT}/`;
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'stage');
const PY = process.platform === 'win32' ? path.join(RES, 'python', 'python.exe') : path.join(RES, 'python', 'bin', 'python3');
const BACKEND = path.join(RES, 'form3d', 'backend');
const WEB = path.join(RES, 'form3d', 'web');

let win = null;
let server = null;
let quitting = false;
let logStream = null;
let pageTitle = 'FORM3D';
let updateNote = '';

/** 창 제목 = 편집기 제목 + 업데이트 진행 상황 */
function refreshTitle() {
  if (win) win.setTitle(updateNote ? `${pageTitle}  ·  ${updateNote}` : pageTitle);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

/** 저장 폴더: 예전 방식(npm run dev)의 로컬 서버와 똑같이 '사용자 폴더\\Documents\\FORM3D' 를 씀
 *  (OneDrive 가 문서 폴더를 옮겨 둔 PC에서도 예전 프로젝트·AI 키·설정을 그대로 이어서 쓰도록) */
function dataDir() {
  const docs = path.join(os.homedir(), 'Documents');
  return path.join(fs.existsSync(docs) ? docs : os.homedir(), 'FORM3D');
}

/** 예전 방식에서 'npm run ai:key' 로 저장한 Claude 키(backend\\.env)를 찾아 그대로 사용 (값은 기록하지 않음) */
function legacyEnvKeys() {
  const out = {};
  const desktops = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'OneDrive', '바탕 화면')];
  for (const d of desktops) {
    const f = path.join(d, 'FORM3D', 'backend', '.env');
    try {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*(ANTHROPIC_API_KEY|DASHSCOPE_API_KEY)\s*=\s*["']?([^"'\s]+)["']?\s*$/);
        if (m && !out[m[1]]) out[m[1]] = m[2];
      }
    } catch {
      /* 없으면 넘어감 */
    }
  }
  return out;
}

function log(line) {
  try {
    if (!logStream) {
      fs.mkdirSync(path.join(dataDir(), 'logs'), { recursive: true });
      logStream = fs.createWriteStream(path.join(dataDir(), 'logs', 'server.log'), { flags: 'w' });
    }
    logStream.write(line.endsWith('\n') ? line : line + '\n');
  } catch {
    /* 로그 실패는 무시 */
  }
}

function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

function health() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}api/health`, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => { req.destroy(); resolve(null); });
  });
}

function startServer() {
  log(`[FORM3D] ${new Date().toISOString()} 서버 시작: ${PY}`);
  server = spawn(PY, ['-m', 'app.main'], {
    cwd: BACKEND,
    windowsHide: true,
    env: {
      ...legacyEnvKeys(),
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      FORM3D_PORT: String(PORT),
      FORM3D_WEB_DIST: WEB,
      FORM3D_DATA_DIR: dataDir(),
    },
  });
  server.stdout.on('data', (d) => log(String(d)));
  server.stderr.on('data', (d) => log(String(d)));
  server.on('exit', (code) => {
    log(`[FORM3D] 서버 종료 (코드 ${code})`);
    server = null;
    if (!quitting && win) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: 'FORM3D',
        message: '로컬 서버가 멈췄습니다.',
        detail: `저장·AI 기능이 꺼졌습니다. 프로그램을 다시 시작해 주세요.\n자세한 내용: ${path.join(dataDir(), 'logs', 'server.log')}`,
      });
    }
  });
}

function stopServer() {
  if (server && !server.killed) server.kill();
}

async function start() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0d12',
    title: 'FORM3D',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // 외부 링크(ollama.com 등)는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(URL)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL) && !url.startsWith('file:')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  // 저장하지 않은 변경이 있으면 편집기가 닫기를 막음 → 사용자에게 물어봄
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'FORM3D',
      message: '저장하지 않은 변경이 있습니다.',
      detail: '저장하지 않고 닫으면 마지막 저장 이후의 작업이 사라집니다. (자동 복구 기록은 남습니다)',
      buttons: ['저장하지 않고 닫기', '돌아가기'],
      defaultId: 1,
      cancelId: 1,
    });
    if (r === 0) e.preventDefault();
  });
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    pageTitle = title;
    refreshTitle();
  });
  win.on('closed', () => (win = null));
  await win.loadFile(path.join(__dirname, 'loading.html'));

  if (await portBusy(PORT)) {
    await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'FORM3D',
      message: `이미 다른 프로그램이 ${PORT}번 포트를 쓰고 있습니다.`,
      detail: '예전 방식(npm run dev)으로 FORM3D를 켜 두셨다면 그 창(cmd)을 닫고 다시 실행해 주세요.',
    });
    app.quit();
    return;
  }
  if (!fs.existsSync(PY)) {
    await dialog.showMessageBox(win, { type: 'error', title: 'FORM3D', message: '프로그램 파일 일부가 없습니다.', detail: '다시 설치해 주세요.' });
    app.quit();
    return;
  }
  startServer();
  for (let i = 0; i < 120; i++) {
    const h = await health();
    if (h && h.ok) {
      if (win) await win.loadURL(URL);
      checkForUpdates();
      return;
    }
    if (!server) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (win) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: 'FORM3D',
      message: '로컬 서버를 시작하지 못했습니다.',
      detail: `자세한 내용: ${path.join(dataDir(), 'logs', 'server.log')}`,
    });
  }
  app.quit();
}

function checkForUpdates() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => {
    log(`[업데이트] 확인 실패: ${e?.message ?? e}`);
    updateNote = '';
    refreshTitle();
    if (win) win.setProgressBar(-1);
  });
  let newVersion = '';
  autoUpdater.on('update-available', (info) => {
    newVersion = info.version;
    log(`[업데이트] 새 버전 ${info.version} 내려받는 중`);
    updateNote = `새 버전 ${info.version} 내려받는 중…`;
    refreshTitle();
  });
  // 내려받는 동안 창 제목과 작업 표시줄 아이콘에 진행률 표시
  autoUpdater.on('download-progress', (p) => {
    if (!win) return;
    win.setProgressBar(p.percent / 100);
    updateNote = `새 버전 ${newVersion} 내려받는 중 ${Math.round(p.percent)}%`;
    refreshTitle();
  });
  autoUpdater.on('update-downloaded', async (info) => {
    if (!win) return;
    win.setProgressBar(-1);
    updateNote = `새 버전 ${info.version} 준비됨 (닫으면 자동 적용)`;
    refreshTitle();
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'FORM3D 업데이트',
      message: `새 버전 ${info.version}이(가) 준비되었습니다.`,
      detail: '지금 다시 시작해서 적용할까요? (나중에 하면 프로그램을 닫을 때 자동으로 적용됩니다)\n저장하지 않은 작업이 있으면 먼저 저장하세요.',
      buttons: ['지금 다시 시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response === 0) {
      quitting = true;
      stopServer();
      autoUpdater.quitAndInstall();
    }
  });
  autoUpdater.checkForUpdates().catch(() => undefined);
}

app.on('before-quit', () => {
  quitting = true;
  stopServer();
});
app.on('window-all-closed', () => app.quit());
