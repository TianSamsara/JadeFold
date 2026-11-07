const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/smart-desktop', String(Date.now()));
async function waitForState(page, predicate, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Timed out waiting for smart workflow');
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, '智能均衡-高码率.mp4');
  const tight = path.join(directory, '智能均衡-紧凑HEVC.mp4');
  const output = path.join(directory, 'output'); await fs.mkdir(output);
  await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '18', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-c:a', 'aac', '-b:a', '128k', input]);
  await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-i', input, '-t', '2', '-an', '-c:v', 'libx265', '-preset', 'fast', '-crf', '40', '-x265-params', 'pools=2:frame-threads=1', tight]);
  const source = await engine.inspect(input);
  const compact = await engine.inspect(tight);
  const env = { ...process.env, FRAME_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await waitForState(page, state => !state.hardware.detecting);
    assert.equal(await page.getByRole('button', {name:'智能均衡',exact:true}).getAttribute('aria-pressed'), 'true');
    await page.locator('.advanced-settings summary').click();
    assert.equal(await page.getByRole('combobox', { name: '智能编码兼容性' }).inputValue(), 'preserve');
    assert.equal(await page.getByRole('combobox', { name: '输出格式' }).inputValue(), 'mp4');
    await app.evaluate(({ dialog, shell }, payload) => {
      dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [payload.output] : [payload.input, payload.tight] });
      shell.showItemInFolder = file => { globalThis.smartRevealed = file; };
    }, { input, tight, output });
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 2);
    await page.locator('.directory-path').click();
    await waitForState(page, state => state.outputDirectory === output);
    await page.locator('.start-button').click();
    const finished = await waitForState(page, state => !state.busy && state.jobs.every(job => ['completed', 'skipped', 'failed'].includes(job.status)));
    const [encoded, skipped] = finished.jobs;
    assert.equal(encoded.status, 'completed', encoded.error || JSON.stringify(encoded.smartAnalysis));
    assert.equal(encoded.smartAnalysis.samples.length, 3); assert.equal(encoded.smartAnalysis.decision, 'encode');
    assert.ok(encoded.smartAnalysis.minVmaf >= 93 && encoded.smartAnalysis.minSSIM >= 0.97);
    assert.ok(encoded.outputSize <= source.size * 0.95);
    assert.equal(encoded.options.audio, 'copy'); assert.equal(encoded.options.resolution, 'original');
    const metadata = await engine.probeMedia(encoded.output);
    assert.equal(metadata.width, source.width); assert.equal(metadata.height, source.height); assert.equal(metadata.fps, source.fps);
    assert.equal(metadata.audioCodec, source.audioCodec);
    const streamHash = async file => (await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).toString().trim();
    assert.equal(await streamHash(input), await streamHash(encoded.output));
    assert.equal(skipped.status, 'skipped', JSON.stringify(skipped)); assert.ok(!skipped.output);
    assert.ok(await page.getByText('已保留原片', { exact: true }).count());
    await page.getByRole('button', { name: `查看 ${compact.name} 的原片`, exact: true }).click();
    assert.equal(await app.evaluate(() => globalThis.smartRevealed), tight);
    assert.equal((await fs.readdir(output)).length, 1);
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'history.json'), 'utf8'));
    assert.equal(persisted.history.length, 2); assert.equal(persisted.history.filter(job => job.status === 'skipped').length, 1);
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-smart.png'), scale: 'css' });
    await page.getByRole('button', { name: '处理记录', exact: true }).click();
    await page.getByText(compact.name, { exact: true }).waitFor();
    assert.ok(await page.getByText('已保留原片', { exact: true }).count());
    await page.getByRole('button', { name: '视频压缩', exact: false }).click();
    await page.getByRole('button', { name: `重新分析 ${compact.name}`, exact: true }).click();
    await waitForState(page, state => state.jobs[1].status === 'queued');
    await page.locator('.start-button').click();
    await waitForState(page, state => state.busy && state.jobs[1].status === 'processing');
    await page.getByRole('button', { name: '取消压缩', exact: true }).click();
    const cancelled = await waitForState(page, state => !state.busy);
    assert.equal(cancelled.jobs[1].status, 'cancelled', JSON.stringify(cancelled.jobs[1]));
    assert.equal((await fs.readdir(output)).length, 1); assert.deepEqual(errors, []);
    await fs.access(input); await fs.access(tight);
    console.log(JSON.stringify({ passed: true, packaged: !!process.env.FRAME_PACKAGED_EXE, encoded: { crf: encoded.options.crf, bytes: encoded.outputSize, sourceBytes: source.size, samples: encoded.smartAnalysis.samples.length, minVmaf: encoded.smartAnalysis.minVmaf, minSSIM: encoded.smartAnalysis.minSSIM }, compact: { status: skipped.status, sourceBytes: compact.size, reason: skipped.skipReason }, cancellation: cancelled.jobs[1].status, audioBitExact: true }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  const reopened = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  try {
    const page = await reopened.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await page.getByRole('button', { name: '处理记录', exact: true }).click();
    await page.getByRole('button', { name: `重新分析 ${compact.name}`, exact: true }).click();
    const queued = await waitForState(page, state => state.jobs.length === 1 && !state.importing);
    assert.equal(queued.jobs[0].status, 'queued'); assert.equal(queued.jobs[0].path, tight);
    await page.getByRole('heading', { name: '文件队列', exact: true }).waitFor();
    console.log(JSON.stringify({ historyRetryAfterRestart: true }));
  } finally { await reopened.evaluate(({ app }) => app.exit(0)).catch(() => {}); await reopened.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
