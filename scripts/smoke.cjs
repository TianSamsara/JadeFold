const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const data = path.join(root, '.test-artifacts/desktop', String(Date.now()));
async function waitForState(page, predicate, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for application state');
}
(async () => {
  await fs.mkdir(data, { recursive: true });
  const tinyInput = path.join(root, '.test-artifacts/engine/自动回退验证.mp4');
  const engine = require('../electron/engine.cjs');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=32x32:rate=12', '-t', '1', '-c:v', 'libx264', tinyInput]);
  const env = { ...process.env, FRAME_TEST_DATA: data }; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  console.log('Desktop launched');
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await page.getByRole('button', { name: '快速压缩', exact: true }).click();
    await page.getByRole('combobox', { name: '视频编码', exact: true }).selectOption('h264');
    await page.waitForFunction(() => !!window.frame);
    console.log('Renderer ready');
    const ready = await page.evaluate(async () => (await window.frame.getState()).engineReady); assert.ok(ready);
    const detected = await waitForState(page, state => !state.hardware.detecting);
    const expectedEncoder = ['nvenc', 'qsv', 'amf'].find(id => detected.hardware.encoders.some(item => item.id === id && item.codecs.includes('h264'))) || 'cpu';
    assert.equal(await page.getByRole('combobox', { name: '加速方式', exact: true }).inputValue(), 'auto');
    assert.equal(await page.locator('.wordmark').innerText(), '白玉京');
    const backgroundSize = await page.evaluate(async () => {
      const url = getComputedStyle(document.querySelector('.main-shell')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];
      const image = new Image(); image.src = url; await image.decode(); return image.naturalWidth;
    });
    assert.ok(backgroundSize >= 1500, 'Packaged background asset should load');
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-empty.png'), scale: 'css' });
    const input = path.join(root, ".test-artifacts/engine/海边旅行 'sample'.mp4");
    const output = path.join(data, 'output'); await fs.mkdir(output, { recursive: true });
    await app.evaluate(({ dialog }, payload) => { dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? payload.output : payload.input] }); }, { input, output });
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await page.getByText("海边旅行 'sample'.mp4", { exact: true }).waitFor();
    await waitForState(page, state => !state.importing);
    console.log('Imported');
    await page.locator('.directory-path').click();
    await waitForState(page, state => state.outputDirectory === output);
    console.log('Output directory set');
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-queue.png'), scale: 'css' });
    await page.locator('.start-button').click();
    console.log('Compression started');
    const state = await waitForState(page, state => ['completed', 'failed', 'cancelled'].includes(state.jobs[0]?.status));
    console.log('Terminal state:', JSON.stringify({ status: state.jobs[0].status, error: state.jobs[0].error }));
    assert.equal(state.jobs[0].status, 'completed'); assert.ok(state.jobs[0].outputSize > 0);
    assert.equal(state.jobs[0].encoder, expectedEncoder, state.jobs[0].notice);
    await fs.access(state.jobs[0].output);
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-completed.png'), scale: 'css' });
    await page.getByRole('button', { name: '处理记录', exact: true }).click();
    await page.getByText("海边旅行 'sample'.mp4", { exact: true }).waitFor();
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    const persisted = JSON.parse(await fs.readFile(path.join(data, 'history.json'), 'utf8'));
    assert.equal(persisted.history[0].output, state.jobs[0].output);
    await page.getByRole('button', { name: /^视频压缩/ }).click();
    await page.getByRole('button', { name: '使用 CPU', exact: true }).click();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 1);
    await page.locator('.start-button').click();
    const cpuState = await waitForState(page, state => ['completed', 'failed', 'cancelled'].includes(state.jobs[0]?.status));
    assert.equal(cpuState.jobs[0].status, 'completed'); assert.equal(cpuState.jobs[0].encoder, 'cpu');
    let fallback = 'not applicable';
    if (expectedEncoder === 'nvenc') {
      await page.getByRole('button', { name: '使用显卡', exact: true }).click();
      await page.getByRole('button', { name: '清空', exact: true }).click();
      await app.evaluate(({ dialog }, input) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] }); }, tinyInput);
      await page.getByRole('button', { name: '添加视频', exact: true }).click();
      await waitForState(page, state => !state.importing && state.jobs.length === 1);
      await page.locator('.start-button').click();
      const fallbackState = await waitForState(page, state => ['completed', 'failed', 'cancelled'].includes(state.jobs[0]?.status));
      assert.equal(fallbackState.jobs[0].status, 'completed'); assert.equal(fallbackState.jobs[0].encoder, 'cpu');
      assert.match(fallbackState.jobs[0].notice, /已改用 CPU/);
      assert.ok(!(await fs.readdir(output)).some(name => name.includes('.partial.') || name.startsWith('.jadefold-')));
      fallback = 'verified: tiny frame rejected by NVENC, CPU output saved';
      await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-gpu-fallback.png'), scale: 'css' });
    }
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(320, 600); win.setContentSize(390, 800); });
    await new Promise(resolve => setTimeout(resolve, 200));
    const geometry = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-mobile.png'), scale: 'css' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, encoder: state.jobs[0].encoder, manualCPU: cpuState.jobs[0].encoder, fallback, inputBytes: state.jobs[0].size, outputBytes: state.jobs[0].outputSize, output: state.jobs[0].output, rendererErrors: errors }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(e => { console.error(e); process.exitCode = 1; });
