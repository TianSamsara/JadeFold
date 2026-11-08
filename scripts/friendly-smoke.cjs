const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = process.getBuiltinModule('fs/promises');
const path = require('node:path');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/friendly', String(Date.now()));
async function wait(page, predicate) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    const state = await page.evaluate(() => window.frame.getState());
    if (predicate(state)) return state;
    await new Promise(r => setTimeout(r, 80));
  }
  throw Error('Friendly controls workflow timed out');
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, 'output'); await fs.mkdir(output);
  const input = path.join(directory, '可压缩样本.mkv');
  const tiny = path.join(directory, '显卡回退样本.mkv');
  const short = path.join(directory, '保留原片样本.mkv');
  for (const [file, size, duration] of [[input, '640x360', '2'], [tiny, '96x96', '2'], [short, '640x360', '0.4']]) {
    await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24`, '-t', duration, '-an', '-c:v', 'ffv1', file]);
  }
  const env = { ...process.env, FRAME_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE; delete env.FRAME_DEV_URL;
  const launch = () => electron.launch({ args: process.env.FRAME_PACKAGED_EXE ? [] : [root], executablePath: process.env.FRAME_PACKAGED_EXE || undefined, env });
  let app = await launch(); let keptId; let encoded;
  try {
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), '0.8.0');
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    const ready = await wait(page, s => !s.hardware.detecting);
    const button = name => page.getByRole('button', { name, exact: true });
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('baiyujing-ningying-options')));
    await button('尽量保留细节').click(); assert.equal((await saved()).qualityPreference, 'detail');
    await button('文件更小').click(); assert.equal((await saved()).qualityPreference, 'smaller');
    await button('清晰且适中').click();
    await button('手动调画质').click();
    await page.getByRole('slider', { name: '画面细节' }).press('Home'); assert.equal((await saved()).crf, 35);
    await page.getByRole('slider', { name: '画面细节' }).press('End'); assert.equal((await saved()).crf, 18);
    await button('文件更小').click(); assert.equal((await saved()).crf, 28);
    if (ready.hardware.encoders.some(e => e.codecs.length)) {
      await button('使用显卡').click(); assert.equal((await saved()).encoder, 'auto'); assert.equal((await saved()).bitDepth, '8');
      await page.reload(); await button('使用显卡').waitFor(); assert.equal(await button('使用显卡').getAttribute('aria-pressed'), 'true');
      assert.equal((await saved()).strategy, 'efficient');
      await button('使用 CPU').click(); assert.equal((await saved()).encoder, 'cpu');
    }
    await button('指定大小').click(); assert.equal(await button('使用显卡').isDisabled(), true);
    await button('手动调画质').click(); await page.locator('.advanced-settings summary').click();
    await page.getByLabel('编码方案', { exact: true }).selectOption('maruko'); assert.equal(await button('使用显卡').isDisabled(), true);
    await page.getByLabel('编码方案', { exact: true }).selectOption('efficient');
    await page.locator('.advanced-settings summary').click();
    for (const width of [1440, 960, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      await page.locator('.friendly-quality').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(root, `.test-artifacts/friendly-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await button('自动压缩').click();
    const expected = ['nvenc', 'qsv', 'amf'].find(id => ready.hardware.encoders.some(e => e.id === id && e.codecs.includes('h264'))) || 'cpu';
    if (expected !== 'cpu') await button('使用显卡').click();
    await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async (_w, o) => ({ canceled: false, filePaths: o.properties.includes('openDirectory') ? [files.output] : [files.input, files.tiny, files.short] }); }, { input, tiny, short, output });
    await button('添加视频').click(); await wait(page, s => s.jobs.length === 3 && !s.importing);
    await page.locator('.directory-path').click(); await wait(page, s => s.outputDirectory === output);
    await page.locator('.start-button').click();
    await wait(page, s => s.busy);
    await page.waitForFunction(() => document.querySelector('[aria-label="使用 CPU"]').matches(':disabled'));
    assert.equal(await button('使用 CPU').isDisabled(), true);
    const result = await wait(page, s => !s.busy && s.jobs.every(j => ['completed', 'skipped', 'failed'].includes(j.status)));
    [encoded] = result.jobs; const fallback = result.jobs[1]; const skipped = result.jobs[2]; keptId = fallback.id;
    assert.equal(encoded.status, 'completed', JSON.stringify(encoded.smartAnalysis));
    assert.equal(encoded.encoder, expected); assert.equal(encoded.smartAnalysis.options.encoder, expected);
    assert.ok(encoded.outputSize <= encoded.size * 0.95);
    assert.equal(skipped.status, 'skipped');
    if (expected === 'nvenc') {
      assert.equal(fallback.smartAnalysis.encoder, 'cpu'); assert.equal(fallback.encoder, 'cpu');
      assert.match(fallback.notice, /重新用 CPU 试压评分/);
      assert.ok(fallback.smartAnalysis.candidates.length > 0, 'CPU fallback must score its own encoded samples');
    }
    await button('处理记录').click();
    await page.screenshot({ path: path.join(root, '.test-artifacts/history-080.png') });
    await button(`删除 ${encoded.name} 的处理记录`).click();
    const deleted = await wait(page, s => s.history.length === 2);
    assert.equal(deleted.history.some(j => j.id === encoded.id), false);
    assert.equal(deleted.jobs.length, 3); await fs.access(input); await fs.access(encoded.output);
    await button(`删除 ${skipped.name} 的处理记录`).click();
    await wait(page, s => s.history.length === 1); await fs.access(short);
    const persisted = JSON.parse(await fs.readFile(path.join(directory, 'history.json'), 'utf8'));
    assert.deepEqual(persisted.history.map(j => j.id), [keptId]); assert.deepEqual(errors, []);
    if (expected !== 'cpu') {
      await page.getByRole('button', { name: /^视频压缩/ }).click();
      await button('清空').click();
      await app.evaluate(({ dialog }, payload) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [payload.input] });
        const filesystem = process.getBuiltinModule('fs/promises'); const nodePath = process.getBuiltinModule('path');
        const originalCopy = filesystem.copyFile; globalThis.injectedPublishFailures = 0;
        filesystem.copyFile = async (...args) => {
          if (nodePath.dirname(args[1]) === payload.output && !globalThis.injectedPublishFailures) {
            globalThis.injectedPublishFailures++;
            throw Object.assign(new Error('Test: one temporary publish failure after GPU full encode'), { code: 'EBUSY' });
          }
          return originalCopy(...args);
        };
      }, { input, output });
      await button('添加视频').click(); await wait(page, s => s.jobs.length === 1 && !s.importing);
      await page.locator('.start-button').click();
      const retried = await wait(page, s => !s.busy && s.jobs[0].status !== 'queued');
      const cpu = retried.jobs[0]; assert.equal(cpu.status, 'completed', cpu.error);
      assert.equal(cpu.encoder, 'cpu'); assert.equal(cpu.options.encoder, 'cpu'); assert.equal(cpu.smartAnalysis.options.encoder, 'cpu');
      assert.match(cpu.notice, /显卡完整编码失败.*重新用 CPU 试压评分/);
      assert.ok(cpu.smartAnalysis.candidates.length > 0); assert.ok(cpu.outputSize <= cpu.size * 0.95);
      assert.equal(await app.evaluate(() => globalThis.injectedPublishFailures), 1);
      await button('处理记录').click(); await button(`删除 ${cpu.name} 的处理记录`).click();
      await wait(page, s => s.history.length === 1); await fs.access(cpu.output);
      console.log(JSON.stringify({ injectedFullEncodeFailureRescoresCPU: true, cpuCrf: cpu.options.crf, gpuCrf: encoded.options.crf }));
    }
    console.log(JSON.stringify({ passed: true, packaged: !!process.env.FRAME_PACKAGED_EXE, actualEncoder: encoded.encoder, smartFallback: fallback.smartAnalysis.encoder, qualitySliderDirection: true, singleHistoryDelete: true, skippedHistoryDelete: true, originalAndOutputKept: true }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  app = await launch();
  try {
    const page = await app.firstWindow(); await page.getByRole('heading', { name: '凝影阁', exact: true }).waitFor();
    const state = await page.evaluate(() => window.frame.getState());
    assert.deepEqual(state.history.map(j => j.id), [keptId]);
    await page.getByRole('button', { name: '处理记录', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: `删除 ${encoded.name} 的处理记录`, exact: true }).count(), 0);
    await page.getByRole('button', { name: '清空记录', exact: true }).click(); await wait(page, s => s.history.length === 0);
    await fs.access(encoded.output); await fs.access(input); await fs.access(tiny); await fs.access(short);
    console.log(JSON.stringify({ historyDeletionPersistsAfterRestart: true, clearHistoryKeepsFiles: true }));
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
