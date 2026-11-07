const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/quality-desktop', String(Date.now()));
async function waitForState(page, predicate) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error('Timed out waiting for quality workflow');
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const env = { ...process.env, FRAME_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const app = await electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    await waitForState(page, state => !state.hardware.detecting);
    const scheme = page.getByRole('combobox', { name: '编码方案', exact: true });
    assert.equal(await page.getByRole('button', {name:'智能均衡',exact:true}).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', {name:'精细压缩',exact:true}).click();
    await page.locator('.advanced-settings summary').click();
    await page.getByRole('combobox', { name: '素材类型', exact: true }).selectOption('screen');
    assert.equal(await page.getByRole('combobox', { name: '视频编码', exact: true }).inputValue(), 'h264');
    await page.getByRole('combobox', { name: '素材类型', exact: true }).selectOption('animation');
    assert.equal(await page.getByRole('combobox', { name: '色深', exact: true }).inputValue(), '10');
    await scheme.selectOption('maruko');
    assert.equal(await page.getByRole('combobox', { name: '编码速度', exact: true }).inputValue(), 'veryslow');
    await page.getByRole('button', {name:'指定大小',exact:true}).click();
    await page.locator('.advanced-settings summary').click();
    await scheme.selectOption('maruko');
    await page.getByRole('spinbutton', { name: '目标大小 MB', exact: true }).fill('0.15');
    const input = path.join(root, '.test-artifacts/quality/带音轨的画质样本.mp4');
    const output = path.join(directory, 'output'); await fs.mkdir(output);
    await app.evaluate(({ dialog }, payload) => { dialog.showOpenDialog = async (_win, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? payload.output : payload.input] }); }, { input, output });
    await page.getByRole('button', { name: '添加视频', exact: true }).click();
    await waitForState(page, state => !state.importing && state.jobs.length === 1);
    await page.locator('.directory-path').click();
    await waitForState(page, state => state.outputDirectory === output);
    await page.locator('.start-button').click();
    const finished = await waitForState(page, state => !state.busy && state.jobs[0].status !== 'queued');
    const job = finished.jobs[0]; assert.equal(job.status, 'completed', job.error);
    assert.equal(job.options.strategy, 'maruko'); assert.equal(job.options.rateControl, 'size');
    const video = await engine.inspect(job.output); assert.equal(video.width, 640); assert.equal(video.height, 360);
    assert.ok(job.outputSize <= 0.15 * 1024 * 1024 * 1.15);
    await page.locator('.settings-panel').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(root, '.test-artifacts/desktop-quality.png'), scale: 'css' });
    console.log(JSON.stringify({ passed: true, strategy: job.options.strategy, rateControl: job.options.rateControl, bytes: job.outputSize, width: video.width, height: video.height }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
