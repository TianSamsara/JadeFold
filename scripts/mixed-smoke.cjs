const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/mixed', String(Date.now()));
async function waitForState(page, predicate, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for mixed queue');
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const source = path.join(directory, '混合压缩一.mp4');
  const second = path.join(directory, '混合压缩二.mp4');
  const third = path.join(directory, '等待处理三.mp4');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '8', '-c:v', 'libx264', '-preset', 'fast', '-crf', '16', source]);
  await fs.copyFile(source, second); await fs.copyFile(source, third);
  const env = { ...process.env, FRAME_TEST_DATA: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await page.getByRole('button', { name: '快速压缩', exact: true }).click();
    await page.getByRole('combobox', { name: '视频编码', exact: true }).selectOption('h264');
    const detected = await waitForState(page, state => !state.hardware.detecting);
    const gpu = ['nvenc', 'qsv', 'amf'].find(id => detected.hardware.encoders.some(item => item.id === id && item.codecs.includes('h264')));
    if (!gpu) { console.log('Mixed integration skipped: no usable GPU encoder'); return; }
    const output = path.join(directory, 'output');
    await fs.mkdir(output);
    await app.evaluate(({ dialog }, payload) => { dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [payload.output] : payload.inputs }); }, { output, inputs: [source, second] });
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 2);
    await page.locator('.directory-path').click();
    await waitForState(page, state => state.outputDirectory === output);
    await page.getByRole('switch', { name: 'CPU + 显卡混合并行', exact: true }).check();
    await page.locator('.advanced-settings summary').click();
    await page.getByLabel('编码速度', { exact: true }).selectOption('slow');
    await page.locator('.start-button').click();
    const running = await waitForState(page, state => state.jobs.filter(job => job.status === 'processing' && job.encoder).length === 2);
    assert.deepEqual(running.jobs.map(job => job.encoder).sort(), ['cpu', gpu].sort());
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-mixed.png'), scale: 'css' });
    const finished = await waitForState(page, state => !state.busy);
    assert.ok(finished.jobs.every(job => job.status === 'completed'), JSON.stringify(finished.jobs.map(job => ({ status: job.status, error: job.error }))));
    const saved = JSON.parse(await fs.readFile(path.join(directory, 'profile/history.json'), 'utf8'));
    assert.equal(saved.history.length, 2); assert.equal(new Set(saved.history.map(job => job.id)).size, 2);
    for (const job of finished.jobs) { const video = await engine.inspect(job.output); assert.equal(video.width, 1280); assert.equal(video.height, 720); assert.ok(Math.abs(video.duration - job.duration) < 0.2); }
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await app.evaluate(({ dialog }, inputs) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: inputs }); }, [source, second, third]);
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 3);
    await page.locator('.start-button').click();
    await waitForState(page, state => state.jobs.filter(job => job.status === 'processing' && job.encoder).length === 2);
    await page.getByRole('button', { name: '取消压缩', exact: true }).click();
    const cancelled = await waitForState(page, state => !state.busy);
    assert.equal(cancelled.jobs[2].status, 'queued');
    assert.equal(cancelled.jobs.filter(job => job.status === 'cancelled').length, 2);
    assert.ok(!(await fs.readdir(output)).some(name => name.includes('.partial.') || name.startsWith('.jadefold-')));
    console.log(JSON.stringify({ passed: true, simultaneousEncoders: running.jobs.map(job => job.encoder), completed: finished.jobs.length, cancelled: 2, waiting: 1, historyRecords: saved.history.length }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
