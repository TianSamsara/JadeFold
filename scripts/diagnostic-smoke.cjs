const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/diagnostic', String(Date.now()));
async function waitForState(page, predicate) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Timed out waiting for transcode diagnostics');
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, 'compact-hevc.mp4');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24,noise=alls=10:allf=t+u', '-t', '8', '-an', '-c:v', 'libx265', '-crf', '34', '-preset', 'fast', '-x265-params', 'pools=2:frame-threads=1', input]);
  const env = { ...process.env, FRAME_TEST_DATA: path.join(directory, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await waitForState(page, state => !state.hardware.detecting);
    await page.getByRole('combobox', { name: '编码方案', exact: true }).selectOption('standard');
    await page.getByRole('combobox', { name: '加速方式', exact: true }).selectOption('cpu');
    await page.getByRole('slider').press('Home');
    const output = path.join(directory, 'output'); await fs.mkdir(output);
    await app.evaluate(({ dialog }, payload) => { dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? payload.output : payload.input] }); }, { input, output });
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 1);
    await page.getByText('原片已是 H.265，转为 H.264 可能变大', { exact: true }).waitFor();
    const budgetButton = page.getByRole('button', { name: '按原片 85% 设置目标大小', exact: true });
    assert.equal(await budgetButton.count(), 1);
    if (await budgetButton.count()) {
      await budgetButton.click();
      assert.equal(await page.getByRole('combobox', { name: '压缩模式', exact: true }).inputValue(), 'size');
      await page.getByRole('combobox', { name: '压缩模式', exact: true }).selectOption('quality');
    }
    await page.locator('.directory-path').click(); await waitForState(page, state => state.outputDirectory === output);
    await page.getByRole('button', { name: /开始压缩/ }).click();
    const finished = await waitForState(page, state => !state.busy && state.jobs[0].status !== 'queued');
    const job = finished.jobs[0]; assert.equal(job.status, 'completed', job.error); assert.equal(job.compressionOutcome, 'expanded');
    assert.equal(job.codec, 'hevc'); assert.equal(job.outputCodec, 'h264'); assert.ok(job.videoBitrate > 0); assert.ok(job.outputVideoBitrate > job.videoBitrate);
    await page.getByText('转码完成', { exact: true }).waitFor();
    assert.equal(await page.locator('.file-status.no-reduction').count(), 1);
    await page.getByText(/本次完成了转码，但没有减小文件/).waitFor();
    await fs.access(job.output);
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-diagnostic.png'), scale: 'css' });
    console.log(JSON.stringify({ passed: true, sourceCodec: job.codec, outputCodec: job.outputCodec, outcome: job.compressionOutcome, sourceBytes: job.size, outputBytes: job.outputSize }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
