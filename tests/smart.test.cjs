const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('../electron/engine.cjs');
const { sampleWindows, chooseBalanced, measureQuality, planBalanced, passesQuality } = require('../electron/smart.cjs');
const directory = path.resolve(__dirname, '../.test-artifacts/smart');
const options = { encoder: 'cpu', strategy: 'smart', codec: 'h264', bitDepth: '8', speed: 'slow', crf: 24, content: 'general', format: 'mp4', resolution: 'original', audio: 'keep', audioKbps: 128, parallel: false, rateControl: 'quality', targetMB: 50, smartCodec: 'preserve' };
let source; let compact;
before(async () => {
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, 'source.mkv');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-t', '2', '-an', '-c:v', 'ffv1', input]);
  source = await engine.inspect(input);
  const tight = path.join(directory, 'tight-hevc.mp4');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-i', input, '-an', '-c:v', 'libx265', '-preset', 'fast', '-crf', '40', '-x265-params', 'pools=2:frame-threads=1', tight]);
  compact = await engine.inspect(tight);
});
test('samples cover multiple parts of a long video without exceeding its duration', () => {
  const windows = sampleWindows(5473);
  assert.equal(windows.length, 3); assert.ok(windows[0].start < windows[1].start && windows[1].start < windows[2].start);
  assert.ok(windows.every(item => item.start >= 0 && item.start + item.duration <= 5473));
  assert.equal(sampleWindows(2).length, 1); assert.equal(sampleWindows(0.1).length, 0);
});
test('a smaller file cannot win with poor quality or incomplete verification', () => {
  const good = { vmaf: 95, lowerTailVmaf: 90, ssim: 0.99 };
  const candidates = [
    { verified: true, estimatedSize: 100, metrics: [{ ...good, vmaf: 60 }] },
    { verified: false, estimatedSize: 200, metrics: [good] },
    { verified: true, estimatedSize: 300, metrics: [good, { ...good, ssim: 0.8 }] },
    { verified: true, estimatedSize: 800, metrics: [good, good] },
  ];
  assert.equal(chooseBalanced(candidates, { size: 1000 }, 'general').estimatedSize, 800);
  assert.equal(chooseBalanced(candidates.slice(0, 3), { size: 1000 }, 'general'), null);
});
test('HDR, special chroma and multi-track inputs are retained instead of silently discarding content', async () => {
  for (const changed of [{ colorTransfer: 'smpte2084' }, { audioStreams: 2 }, { subtitleStreams: 1 }, { pixelFormat: 'yuv444p' }]) {
    const plan = await planBalanced({ ...source, ...changed }, options, directory, () => {}, new AbortController().signal);
    assert.equal(plan.decision, 'skip'); assert.ok(plan.reason.length > 0);
  }
});
test('identical frames score near-perfect despite MKV and MP4 timestamp rounding', async () => {
  const output = path.join(directory, 'lossless.mp4');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-i', source.path, '-an', '-c:v', 'libx264', '-crf', '0', output]);
  const reference = await engine.probeMedia(source.path, { countFrames: true });
  const metricsDirectory = path.join(directory, 'identity-metrics'); await fs.mkdir(metricsDirectory, { recursive: true });
  const metrics = await measureQuality(source.path, output, metricsDirectory, new AbortController().signal, reference.frameCount);
  assert.ok(metrics.vmaf > 99.5, JSON.stringify(metrics)); assert.ok(metrics.ssim > 0.99999, JSON.stringify(metrics));
});
test('real sample scoring chooses settings and the guarded full output is smaller', async () => {
  const plan = await planBalanced(source, options, directory, () => {}, new AbortController().signal, { cpuThreads: 2 });
  assert.equal(plan.decision, 'encode', JSON.stringify(plan));
  assert.ok(plan.minVmaf >= 93 && plan.minSSIM >= 0.97); assert.ok(plan.estimatedSaving >= 0.10);
  const output = await engine.compress(source, plan.options, directory, () => {}, new AbortController().signal, { cpuThreads: 2, maxOutputBytes: Math.floor(source.size * 0.95) });
  assert.ok(output.output && !output.skipped); assert.ok(output.outputSize <= source.size * 0.95);
  const metadata = await engine.probeMedia(output.output); assert.equal(metadata.width, source.width); assert.equal(metadata.height, source.height); assert.equal(metadata.fps, source.fps);
});
test('an already tightly compressed HEVC file is skipped instead of enlarged', async () => {
  const plan = await planBalanced(compact, options, directory, () => {}, new AbortController().signal, { cpuThreads: 2 });
  assert.equal(plan.decision, 'skip', JSON.stringify(plan));
  assert.ok(!plan.options); assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('.jadefold-')));
});
test('the final size guard refuses to publish a larger encoded candidate', async () => {
  const output = path.join(directory, 'guard'); await fs.mkdir(output, { recursive: true });
  const before = await fs.readdir(output);
  const result = await engine.compress(compact, { ...options, strategy: 'standard', crf: 18, audio: 'mute' }, output, () => {}, new AbortController().signal, { cpuThreads: 2, maxOutputBytes: Math.floor(compact.size * 0.95) });
  assert.equal(result.skipped, true); assert.ok(!result.output); assert.ok(result.attemptedOutputSize > compact.size);
  assert.deepEqual(await fs.readdir(output), before); await fs.access(compact.path);
});
test('cancelling analysis stops the pipeline and removes sample files', async () => {
  const control = new AbortController();
  await assert.rejects(planBalanced(source, options, directory, () => control.abort(), control.signal), /已取消/);
  assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('.jadefold-')));
});

test('detail preference raises the quality requirement without relaxing size protection', () => {
  const metrics = [{ vmaf: 94, lowerTailVmaf: 86, ssim: 0.975 }];
  assert.equal(passesQuality(metrics, 'general', 'detail'), false);
  assert.equal(passesQuality(metrics, 'general', 'balanced'), true);
  assert.equal(passesQuality(metrics, 'screen', 'balanced'), false);
  assert.equal(passesQuality([{ vmaf: 91, lowerTailVmaf: 82, ssim: 0.965 }], 'general', 'smaller'), true);
  for (const preference of ['detail', 'balanced', 'smaller']) {
    assert.equal(chooseBalanced([{ verified: true, estimatedSize: 960, metrics: [{ vmaf: 100, lowerTailVmaf: 100, ssim: 1 }] }], {size:1000}, 'general', preference), null);
  }
});

test('real available GPU encoders are scored before being used for full automatic output', async t => {
  const hardware = await engine.detectHardware();
  if (!hardware.encoders.some(e => e.codecs.length)) return t.skip('No hardware encoder available on this machine');
  for (const encoder of hardware.encoders) {
    for (const codec of encoder.codecs) {
      const plan = await planBalanced(source, { ...options, encoder: encoder.id, smartCodec: codec === 'h265' ? 'hevc' : 'preserve', qualityPreference: 'detail' }, directory, () => {}, new AbortController().signal, { cpuThreads: 2, hardware });
      assert.equal(plan.decision, 'encode', JSON.stringify(plan));
      assert.equal(plan.options.encoder, encoder.id); assert.equal(plan.options.codec, codec);
      assert.ok(plan.minVmaf >= 95 && plan.minSSIM >= 0.98);
      const result = await engine.compress(source, plan.options, directory, () => {}, new AbortController().signal, { cpuThreads: 2, preserveFrames: true, maxOutputBytes: Math.floor(source.size * 0.95) });
      assert.ok(result.output && !result.skipped); assert.equal(result.encoder, encoder.id);
      assert.ok(result.outputSize <= source.size * 0.95);
      const metadata = await engine.probeMedia(result.output, {countFrames:true});
      assert.equal(metadata.frameCount, 48); assert.equal(metadata.width, source.width); assert.equal(metadata.height, source.height);
      t.diagnostic(`${encoder.id}/${codec}: ${plan.minVmaf.toFixed(2)} VMAF, ${plan.minSSIM.toFixed(5)} SSIM, ${result.outputSize} bytes`);
    }
  }
});

test('automatic encoder resolves the source codec and explicit GPU never reduces 10bit depth silently', async () => {
  const hardware = {encoders:[{id:'nvenc',codecs:['h264']}]};
  const signal = new AbortController().signal;
  const mismatch = await planBalanced(compact, {...options,encoder:'nvenc'}, directory, () => {}, signal, {hardware});
  assert.equal(mismatch.decision, 'skip'); assert.equal(mismatch.candidates.length, 0);
  const tenbit = await planBalanced({...source, codec:'hevc', pixelFormat:'yuv420p10le'}, {...options,encoder:'nvenc'}, directory, () => {}, signal, {hardware:{encoders:[{id:'nvenc',codecs:['h265']}]}});
  assert.equal(tenbit.decision, 'skip'); assert.match(tenbit.reason, /10bit/); assert.equal(tenbit.candidates.length, 0);
});
