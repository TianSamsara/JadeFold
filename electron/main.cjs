const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { inspect, compress, validateOptions, binaryPaths, detectHardware, resolveEncoder, encoderNames } = require('./engine.cjs');
if (process.env.FRAME_TEST_DATA) app.setPath('userData', path.resolve(process.env.FRAME_TEST_DATA));
let window; let jobs = []; let history = []; let busy = false; let importing = false; let controller; let stop = false; let lastError = ''; let engineReady = false;
let outputDirectory;
let hardware = { detecting: true, encoders: [] };
const snapshot = () => ({ jobs, history, busy, importing, outputDirectory, lastError, engineReady, hardware });
const emit = () => { if (window && !window.isDestroyed()) window.webContents.send('frame:updated', snapshot()); };
const historyFile = () => path.join(app.getPath('userData'), 'history.json');
async function saveHistory() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(historyFile() + '.tmp', JSON.stringify({ history: history.slice(0, 100), outputDirectory }), 'utf8');
  await fs.rename(historyFile() + '.tmp', historyFile());
}
async function addFiles(paths) {
  if (busy || importing) throw new Error('当前正在处理文件，请稍后再添加。');
  if (!Array.isArray(paths) || paths.length > 200) throw new Error('每次最多添加 200 个视频。');
  importing = true; lastError = ''; emit();
  const errors = [];
  try {
    for (const file of paths) {
      if (jobs.some(job => job.path.toLowerCase() === String(file).toLowerCase())) continue;
      try { jobs.push(await inspect(file)); emit(); }
      catch (error) { errors.push(`${path.basename(String(file))}：${error.message.slice(0, 250)}`); }
    }
  } finally { importing = false; lastError = errors.join('\n'); emit(); }
  return snapshot();
}
async function runQueue(options) {
  try {
    for (const job of jobs) {
      if (stop) break;
      if (job.status !== 'queued') continue;
      controller = new AbortController();
      job.status = 'processing'; job.progress = 0; job.startedAt = Date.now(); job.error = ''; emit();
      try {
        let effective = resolveEncoder(options, hardware);
        job.encoder = effective.encoder; job.encoderLabel = encoderNames[effective.encoder]; job.notice = ''; emit();
        const encode = () => compress(job, effective, outputDirectory, progress => { job.progress = progress; emit(); }, controller.signal);
        let result;
        try { result = await encode(); }
        catch (error) {
          if (options.encoder !== 'auto' || effective.encoder === 'cpu' || controller.signal.aborted) throw error;
          job.notice = `${encoderNames[effective.encoder]} 处理此视频失败，已改用 CPU 编码。`;
          effective = { ...effective, encoder: 'cpu' }; job.encoder = 'cpu'; job.encoderLabel = encoderNames.cpu; job.progress = 0; emit();
          result = await encode();
        }
        Object.assign(job, result);
        job.status = 'completed'; job.progress = 100;
        history.unshift({ ...job }); history = history.slice(0, 100);
        await saveHistory().catch(() => { lastError = '视频已保存，但处理记录未能写入磁盘。'; });
      } catch (error) { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; }
      emit();
    }
  } finally { busy = false; controller = null; stop = false; emit(); }
}
function handle(name, handler) {
  ipcMain.handle(`frame:${name}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的应用请求。');
    return handler(...args);
  });
}
app.whenReady().then(async () => {
  outputDirectory = path.join(app.getPath('videos'), '白玉京', '凝影阁');
  try { const data = JSON.parse(await fs.readFile(historyFile(), 'utf8')); history = Array.isArray(data.history) ? data.history.slice(0, 100) : []; if (typeof data.outputDirectory === 'string' && path.isAbsolute(data.outputDirectory)) outputDirectory = data.outputDirectory; } catch {}
  try { const tools = binaryPaths(); await Promise.all([fs.access(tools.ffmpeg), fs.access(tools.ffprobe)]); engineReady = true; } catch { lastError = '视频引擎尚未准备好。请重新安装应用，开发环境请运行依赖安装脚本。'; }
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 960, minHeight: 700, icon: path.join(__dirname, '../assets/icon.png'), backgroundColor: '#f1f4ed', title: '白玉京 · 凝影阁 | 视频压缩', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (busy) {
      const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续压缩', '取消任务并退出'], defaultId: 0, cancelId: 0, message: '视频正在压缩，确定退出吗？', detail: '退出会取消当前任务，未完成的输出会被清理。' });
      event.preventDefault();
      if (choice === 1) { stop = true; controller?.abort(); const timer = setInterval(() => { if (!busy) { clearInterval(timer); window.destroy(); app.quit(); } }, 100); }
    }
  });
  handle('state', () => snapshot());
  handle('pick', async () => {
    if (busy || importing) return snapshot();
    const result = await dialog.showOpenDialog(window, { title: '添加需要压缩的视频', properties: ['openFile', 'multiSelections'], filters: [{ name: '视频文件', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', 'ts', 'mts', 'm2ts'] }] });
    return result.canceled ? snapshot() : addFiles(result.filePaths);
  });
  handle('add', addFiles);
  handle('directory', async () => {
    if (busy) return snapshot();
    const result = await dialog.showOpenDialog(window, { title: '选择输出文件夹', defaultPath: outputDirectory, properties: ['openDirectory', 'createDirectory'] });
    if (!result.canceled) { outputDirectory = result.filePaths[0]; await saveHistory(); emit(); }
    return snapshot();
  });
  handle('start', async value => {
    if (busy || importing) throw new Error('请等待当前操作完成。');
    if (!engineReady) throw new Error('视频引擎不可用，请重新安装应用。');
    const options = validateOptions(value);
    if (hardware.detecting) throw new Error('正在检测显卡编码能力，请稍候。');
    resolveEncoder(options, hardware);
    if (!jobs.some(job => job.status === 'queued')) throw new Error('请先添加视频，或重试未完成的任务。');
    busy = true; stop = false; lastError = ''; emit();
    void runQueue(options);
    return snapshot();
  });
  handle('cancel', () => { stop = true; controller?.abort(); return snapshot(); });
  handle('remove', id => { if (!busy) jobs = jobs.filter(job => job.id !== id); emit(); return snapshot(); });
  handle('clear', () => { if (!busy) jobs = []; emit(); return snapshot(); });
  handle('retry', id => { const job = jobs.find(item => item.id === id); if (!busy && job && ['failed', 'cancelled'].includes(job.status)) { job.status = 'queued'; job.progress = 0; job.error = ''; } emit(); return snapshot(); });
  handle('reveal', id => { const job = [...jobs, ...history].find(item => item.id === id && item.output); if (job) shell.showItemInFolder(job.output); });
  handle('open-directory', async () => { await fs.mkdir(outputDirectory, { recursive: true }); const error = await shell.openPath(outputDirectory); if (error) throw new Error(error); });
  handle('clear-history', async () => { history = []; await saveHistory(); emit(); return snapshot(); });
  if (process.env.FRAME_DEV_URL === 'http://127.0.0.1:5173') await window.loadURL(process.env.FRAME_DEV_URL);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
  if (engineReady) {
    void detectHardware().then(result => { hardware = result; emit(); }).catch(() => { hardware = { detecting: false, encoders: [] }; emit(); });
  } else { hardware = { detecting: false, encoders: [] }; emit(); }
});
app.on('window-all-closed', () => app.quit());
