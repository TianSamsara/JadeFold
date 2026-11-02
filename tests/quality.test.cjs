const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('../electron/engine.cjs');
const directory = path.resolve(__dirname, '../.test-artifacts/quality');
const options = { codec: 'h264', format: 'mp4', resolution: 'original', crf: 23, speed: 'slow', audio: 'keep', encoder: 'cpu', parallel: false, strategy: 'standard', content: 'general', rateControl: 'quality', targetMB: 0.15, bitDepth: '8', audioKbps: 96 };
let source;
before(async () => {
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, '带音轨的画质样本.mp4');
  await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'fast', '-crf', '10', '-c:a', 'aac', '-b:a', '96k', input]);
  source = await engine.inspect(input);
});
test('precision settings reject incompatible combinations and account for audio', () => {
  assert.throws(() => engine.validateOptions({ ...options, encoder: 'nvenc', rateControl: 'size' }));
  assert.throws(() => engine.validateOptions({ ...options, bitDepth: '10' }));
  assert.throws(() => engine.validateOptions({ ...options, strategy: 'maruko' }));
  assert.equal(engine.validateOptions({ ...options, crf: 23.5 }).crf, 23.5);
  assert.throws(() => engine.validateOptions({ ...options, crf: 23.3 }));
  assert.throws(() => engine.targetVideoBitrate({ ...source, duration: 6000 }, options), /目标体积过小/);
  const muted = engine.targetVideoBitrate(source, { ...options, audio: 'mute' });
  assert.equal(muted - engine.targetVideoBitrate(source, options), 96000);
  assert.throws(() => engine.targetVideoBitrate({ ...source, audioBitrate: 0 }, { ...options, audio: 'copy' }), /原音轨码率/);
});
test('classic reference and animation tuning run through real CPU encoders', async () => {
  for (const settings of [{ ...options, strategy: 'maruko', speed: 'veryslow' }, { ...options, codec: 'h265', content: 'animation', bitDepth: '10', strategy: 'efficient' }]) {
    const result = await engine.compress(source, settings, directory, () => {}, new AbortController().signal, { cpuThreads: 2 });
    const output = await engine.inspect(result.output);
    assert.equal(output.width, source.width); assert.equal(output.height, source.height);
    if (settings.bitDepth === '10') assert.equal(output.pixelFormat, 'yuv420p10le');
  }
});
test('two-pass H.264 and H.265 budget total size and clean all statistics', async () => {
  for (const codec of ['h264', 'h265']) {
    const phases = new Set(); const progress = [];
    const settings = { ...options, codec, rateControl: 'size', bitDepth: codec === 'h265' ? '10' : '8' };
    const result = await engine.compress(source, settings, directory, (value, phase) => { phases.add(phase); progress.push(value); }, new AbortController().signal, { cpuThreads: 2 });
    const output = await engine.inspect(result.output);
    assert.ok(result.outputSize > 0);
    assert.ok(result.outputSize < options.targetMB * 1024 * 1024 * 1.15, `size ${result.outputSize}`);
    assert.ok(Math.abs(output.duration - source.duration) < 0.2);
    assert.equal(phases.size, 2); assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
    assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('.jadefold-')));
  }
});
test('copying audio preserves the compressed audio stream byte for byte', async () => {
  const result = await engine.compress(source, { ...options, audio: 'copy' }, directory, () => {}, new AbortController().signal);
  const extract = file => engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'adts', '-']);
  assert.deepEqual(await extract(result.output), await extract(source.path));
});
test('cancelling before pass two removes pass one statistics and partial video', async () => {
  const control = new AbortController();
  await assert.rejects(engine.compress(source, { ...options, rateControl: 'size' }, directory, (_value, phase) => { if (phase.startsWith('第二遍')) control.abort(); }, control.signal), /已取消/);
  assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('.jadefold-')));
});
