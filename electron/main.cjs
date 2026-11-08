const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runLanes } = require('./queue.cjs');
const { planBalanced, POLICY } = require('./smart.cjs');
const { inspect, compress, validateOptions, binaryPaths, detectHardware, resolveEncoder, encoderNames } = require('./engine.cjs');
if (process.env.FRAME_TEST_DATA) app.setPath('userData', path.resolve(process.env.FRAME_TEST_DATA));
let window; let jobs = []; let history = []; let busy = false; let importing = false; let controller; let lastError = ''; let engineReady = false;
let outputDirectory;
let hardware = { detecting: true, encoders: [] };
let historyWrite = Promise.resolve();
const snapshot = () => ({ jobs, history, busy, importing, outputDirectory, lastError, engineReady, hardware });
const emit = () => { if (window && !window.isDestroyed()) window.webContents.send('frame:updated', snapshot()); };
const historyFile = () => path.join(app.getPath('userData'), 'history.json');
async function saveHistory() {
  const contents = JSON.stringify({ history: history.slice(0, 100), outputDirectory });
  historyWrite = historyWrite.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(historyFile() + '.tmp', contents, 'utf8');
    await fs.rename(historyFile() + '.tmp', historyFile());
  });
  return historyWrite;
}
async function editHistory(change) {
  if (busy) throw new Error('请等当前任务完成后再删除记录。');
  const previous = history; history = change(history);
  try { await saveHistory(); } catch (error) { history = previous; throw error; }
  emit(); return snapshot();
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
  const primary = options.strategy === 'smart' ? options : resolveEncoder(options, hardware);
  const pending = jobs.filter(job => job.status === 'queued');
  const mixed = options.strategy !== 'smart' && options.parallel && primary.encoder !== 'cpu' && pending.length > 1;
  const lanes = mixed ? [primary, { ...primary, encoder: 'cpu' }] : [primary];
  const cpuThreads = Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)));
  const signal = controller.signal;
  try {
    await runLanes(pending, lanes, async (job, lane) => {
      job.status = 'processing'; job.progress = 0; job.startedAt = Date.now(); job.error = ''; emit();
      try {
        let effective = lane;
        const smart = options.strategy === 'smart';
        const analyse = settings => planBalanced(job, settings, outputDirectory, analysis => { job.smartAnalysis = analysis; job.encoder = analysis.encoder; job.encoderLabel = analysis.encoderLabel; job.progress = analysis.progress; job.phaseLabel = analysis.phase; emit(); }, signal, { cpuThreads, hardware });
        if (smart) {
          job.smartAnalysis = await analyse(options);
          if (job.smartAnalysis.decision === 'skip' && options.encoder === 'auto' && ['nvenc', 'qsv', 'amf'].includes(job.smartAnalysis.encoder)) {
            job.smartAnalysis = await analyse({ ...options, encoder: 'cpu' });
            job.smartAnalysis.notice = '显卡试压未找到合适结果，已重新用 CPU 试压评分。';
          }
          job.encoder = job.smartAnalysis.encoder; job.encoderLabel = job.smartAnalysis.encoderLabel; job.notice = job.smartAnalysis.notice || '';
          if (job.smartAnalysis.decision === 'skip') {
            job.status = 'skipped'; job.skipReason = job.smartAnalysis.reason; job.progress = 100; job.phaseLabel = '';
            history = history.filter(item => item.id !== job.id); history.unshift({ ...job }); history = history.slice(0, 100);
            await saveHistory().catch(() => { lastError = '原片已保留，但分析记录未能写入磁盘。'; });
            emit(); return;
          }
          effective = job.smartAnalysis.options;
        }
        job.encoder = effective.encoder; job.encoderLabel = encoderNames[effective.encoder]; job.notice = job.smartAnalysis?.notice || ''; emit();
        const encode = () => compress(job, effective, outputDirectory, (progress, phase) => { job.progress = smart ? 15 + progress * 0.85 : progress; job.phaseLabel = phase; emit(); }, signal, smart ? { cpuThreads, preserveFrames: true, maxOutputBytes: Math.max(1, Math.floor(job.size * (1 - POLICY.actualSaving))) } : mixed ? { cpuThreads } : {});
        let result;
        try { result = await encode(); }
        catch (error) {
          if (options.encoder !== 'auto' || effective.encoder === 'cpu' || signal.aborted) throw error;
          job.notice = `${encoderNames[effective.encoder]} 处理此视频失败，已改用 CPU 编码。`;
          if (smart) {
            job.smartAnalysis = await analyse({ ...options, encoder: 'cpu' });
            job.notice = '显卡完整编码失败，已重新用 CPU 试压评分。';
            job.smartAnalysis.notice = job.notice; job.encoder = 'cpu'; job.encoderLabel = encoderNames.cpu; emit();
            if (job.smartAnalysis.decision === 'skip') {
              result = { skipped: true, skipReason: job.smartAnalysis.reason };
            } else { effective = job.smartAnalysis.options; result = await encode(); }
          } else {
            effective = { ...effective, encoder: 'cpu' }; job.encoder = 'cpu'; job.encoderLabel = encoderNames.cpu; job.progress = 0; emit();
            result = await encode();
          }
        }
        Object.assign(job, result);
        job.status = result.skipped ? 'skipped' : 'completed'; job.progress = 100;
        if (result.skipped) { job.phaseLabel = ''; job.smartAnalysis = { ...job.smartAnalysis, decision: 'skip', reason: result.skipReason }; }
        history = history.filter(item => item.id !== job.id); history.unshift({ ...job }); history = history.slice(0, 100);
        await saveHistory().catch(() => { lastError = '视频已保存，但处理记录未能写入磁盘。'; });
      } catch (error) { job.status = signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; }
      emit();
    }, signal);
  } catch (error) {
    lastError = `队列处理失败：${error.message}`;
  } finally { busy = false; controller = null; emit(); }
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
      const choice = dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续压缩', '取消任务并退出'], defaultId: 0, cancelId: 0, message: '视频正在压缩，确定退出吗？', detail: '退出会取消所有正在处理的任务，未完成的输出会被清理。' });
      event.preventDefault();
      if (choice === 1) { controller?.abort(); const timer = setInterval(() => { if (!busy) { clearInterval(timer); window.destroy(); app.quit(); } }, 100); }
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
    if (options.strategy !== 'smart') resolveEncoder(options, hardware);
    if (!jobs.some(job => job.status === 'queued')) throw new Error('请先添加视频，或重试未完成的任务。');
    busy = true; lastError = ''; controller = new AbortController(); emit();
    void runQueue(options);
    return snapshot();
  });
  handle('cancel', () => { controller?.abort(); return snapshot(); });
  handle('remove', id => { if (!busy) jobs = jobs.filter(job => job.id !== id); emit(); return snapshot(); });
  handle('clear', () => { if (!busy) jobs = []; emit(); return snapshot(); });
  handle('retry', async id => {
    const job = jobs.find(item => item.id === id);
    if (!busy && !importing) {
      if (!job) { const previous = history.find(item => item.id === id && item.status === 'skipped'); if (previous) return addFiles([previous.path]); }
      else if (['failed', 'cancelled', 'skipped'].includes(job.status)) { job.status = 'queued'; job.progress = 0; job.error = ''; job.skipReason = ''; job.smartAnalysis = null; }
    }
    emit(); return snapshot();
  });
  handle('reveal', id => { const job = [...jobs, ...history].find(item => item.id === id && (item.output || item.status === 'skipped')); if (job) shell.showItemInFolder(job.output || job.path); });
  handle('open-directory', async () => { await fs.mkdir(outputDirectory, { recursive: true }); const error = await shell.openPath(outputDirectory); if (error) throw new Error(error); });
  handle('remove-history', async id => {
    if (typeof id !== 'string') throw new Error('记录编号无效。');
    return editHistory(items => items.filter(item => item.id !== id));
  });
  handle('clear-history', () => editHistory(() => []));
  if (process.env.FRAME_DEV_URL === 'http://127.0.0.1:5173') await window.loadURL(process.env.FRAME_DEV_URL);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
  if (engineReady) {
    void detectHardware().then(result => { hardware = result; emit(); }).catch(() => { hardware = { detecting: false, encoders: [] }; emit(); });
  } else { hardware = { detecting: false, encoders: [] }; emit(); }
});
app.on('window-all-closed', () => app.quit());
