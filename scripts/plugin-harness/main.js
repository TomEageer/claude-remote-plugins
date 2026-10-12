// 预览插件离屏测试工具
//
// 单个：npx electron scripts/plugin-harness/main.js --plugin pdf-viewer --file a.pdf --theme dark --out a.png
// 批量：npx electron scripts/plugin-harness/main.js --jobs jobs.json --outdir out/
//
// jobs.json: [{ "name": "pdf-light", "plugin": "pdf-viewer", "file": "/abs/a.pdf", "theme": "light",
//               "expect": "rendered" | "error", "width": 1100, "height": 780,
//               "steps": [{ "js": "document.getElementById('next').click()", "wait": 600, "shot": "page2" },
//                         { "theme": "dark", "wait": 300, "shot": "dark" }] }]
//
// 原样使用 src/plugin-protocol.js 注册 crplugin:// 协议；窗口离屏渲染（不弹窗），
// 等插件发出 cr:rendered / cr:error 后截整个窗口。结果写到 <outdir>/results.json。
'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSchemePrivileges, handleProtocol } = require('./plugin-protocol.js');

const ROOT = path.resolve(__dirname, '..', '..');
const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown',
  json: 'application/json',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pluginsDir = path.resolve(args['plugins-dir'] || path.join(ROOT, 'plugins'));
let jobs;
let outDir;
if (args.jobs) {
  jobs = JSON.parse(fs.readFileSync(args.jobs, 'utf8'));
  outDir = path.resolve(args.outdir || path.dirname(args.jobs));
} else {
  if (!args.plugin || !args.file) {
    console.error('用法: --plugin <id> --file <path> [--theme light|dark] [--out a.png]  或  --jobs jobs.json --outdir dir');
    process.exit(2);
  }
  const out = path.resolve(args.out || 'shot.png');
  outDir = path.dirname(out);
  jobs = [{ name: path.basename(out, '.png'), plugin: args.plugin, file: args.file, theme: args.theme || 'light',
    expect: args.expect || 'rendered', width: Number(args.width) || undefined, height: Number(args.height) || undefined }];
}
fs.mkdirSync(outDir, { recursive: true });

app.setPath('userData', path.join(os.tmpdir(), 'cr-plugin-harness'));
app.commandLine.appendSwitch('force-device-scale-factor', String(args.dpr || 1));
registerSchemePrivileges();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const current = new Map(); // webContents.id -> { job, data, events, onEvent }

ipcMain.handle('harness:job', (e) => {
  const c = current.get(e.sender.id);
  return { plugin: c.job.plugin, name: path.basename(c.job.file), ext: c.ext, mime: c.mime, theme: c.job.theme || 'light', data: c.data };
});
ipcMain.on('harness:event', (e, ev) => {
  const c = current.get(e.sender.id);
  if (!c) return;
  c.events.push({ ...ev, t: ev.t - c.start });
  if (c.onEvent) c.onEvent(ev);
});

function pluginFrame(win) {
  return win.webContents.mainFrame.framesInSubtree.find((f) => f.url.startsWith('crplugin://'));
}

async function shot(win, file) {
  // 离屏窗口：先让它重绘一帧再截
  win.webContents.invalidate();
  await sleep(120);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return path.basename(file);
}

async function runJob(job) {
  const ext = (job.ext || path.extname(job.file).slice(1)).toLowerCase();
  const data = fs.readFileSync(job.file);
  const win = new BrowserWindow({
    show: false,
    width: job.width || 1100,
    height: job.height || 780,
    backgroundColor: '#888888',
    webPreferences: {
      offscreen: true,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setFrameRate(30);
  const c = { job, ext, mime: MIME[ext] || 'application/octet-stream', data: new Uint8Array(data), events: [], start: Date.now() };
  current.set(win.webContents.id, c);
  const consoleMsgs = [];
  win.webContents.on('console-message', (...a) => {
    // Electron 35+ 传单个事件对象；旧版本是 (event, level, message, line, sourceId)
    const ev = a[0];
    const level = ev.level !== undefined ? ev.level : a[1];
    const message = ev.message !== undefined ? ev.message : a[2];
    const sourceId = ev.sourceId !== undefined ? ev.sourceId : a[4];
    const frameUrl = ev.frame && ev.frame.url;
    consoleMsgs.push({ level, message: String(message).slice(0, 600), source: sourceId, frame: frameUrl });
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleMsgs.push({ level: 'crash', message: JSON.stringify(d) }));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => consoleMsgs.push({ level: 'error', message: `did-fail-load ${code} ${desc} ${url}` }));

  const outcome = new Promise((resolve) => {
    c.onEvent = (ev) => { if (ev.type === 'cr:rendered' || ev.type === 'cr:error') resolve(ev); };
    setTimeout(() => resolve({ type: 'timeout' }), job.timeout || 30000);
  });
  await win.loadFile(path.join(__dirname, 'host.html'));
  const first = await outcome;
  await sleep(job.settle || 800);

  const result = {
    name: job.name, plugin: job.plugin, file: job.file, theme: job.theme || 'light', expect: job.expect || 'rendered',
    outcome: first.type, errorMessage: first.message, shots: [], stepErrors: [],
  };
  result.shots.push(await shot(win, path.join(outDir, job.name + '.png')));

  for (const [i, st] of (job.steps || []).entries()) {
    try {
      if (st.theme) win.webContents.send('harness:cmd', { type: 'theme', theme: st.theme });
      if (st.js) {
        const f = pluginFrame(win);
        if (!f) throw new Error('找不到插件 frame');
        const r = await f.executeJavaScript(st.js, true);
        if (r !== undefined) result['step' + i] = r;
      }
      await sleep(st.wait || 500);
      if (st.shot) result.shots.push(await shot(win, path.join(outDir, job.name + '-' + st.shot + '.png')));
    } catch (e) {
      result.stepErrors.push(`step ${i}: ${e.message}`);
    }
  }
  result.events = c.events;
  result.console = consoleMsgs;
  result.consoleErrors = consoleMsgs.filter((m) => m.level === 3 || m.level === 'error' || m.level === 'crash').length;
  result.pass = result.outcome === (job.expect === 'error' ? 'cr:error' : 'cr:rendered') && !result.stepErrors.length;
  current.delete(win.webContents.id);
  win.destroy();
  return result;
}

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();
  handleProtocol([pluginsDir]);
  // 记录插件发出的所有非本地请求（应为空：插件不得联网）
  const network = [];
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    if (!/^(file|crplugin|data|blob|devtools|chrome-extension):/.test(d.url)) network.push(d.url);
    cb({});
  });
  const results = [];
  for (const job of jobs) {
    const t0 = Date.now();
    let r;
    try {
      r = await runJob(job);
    } catch (e) {
      r = { name: job.name, pass: false, outcome: 'harness-error', errorMessage: e.message };
    }
    r.ms = Date.now() - t0;
    results.push(r);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${job.name.padEnd(36)} ${String(r.outcome).padEnd(12)} console错误:${r.consoleErrors ?? '-'}  ${r.ms}ms${r.errorMessage ? '  ' + r.errorMessage : ''}`);
  }
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ network, results }, null, 2));
  console.log(`网络请求: ${network.length ? network.join(', ') : '无'}`);
  console.log(`结果: ${results.filter((r) => r.pass).length}/${results.length} 通过 -> ${path.join(outDir, 'results.json')}`);
  app.exit(results.every((r) => r.pass) ? 0 : 1);
});

app.on('window-all-closed', () => { /* 由 whenReady 流程结束进程 */ });
