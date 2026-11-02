const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { binaryPaths, run, inspect, validateOptions, buildArgs, parseProgress, compress, resolveEncoder, detectHardware } = require('../electron/engine.cjs');
const directory = path.resolve(__dirname, '../.test-artifacts/engine');
const options = { codec: 'h264', format: 'mp4', resolution: '480', crf: 31, speed: 'fast', audio: 'keep', encoder: 'cpu', parallel: false };
let source;
before(async () => {
  await fs.mkdir(directory, { recursive: true });
  source = path.join(directory, "海边旅行 'sample'.mp4");
  await run(binaryPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '3', '-c:v', 'libx264', '-crf', '10', '-c:a', 'aac', source]);
});
test('rejects injected or out-of-range settings', () => {
  assert.throws(() => validateOptions({ ...options, codec: 'h264; whoami' }));
  assert.throws(() => validateOptions({ ...options, crf: NaN }));
  assert.throws(() => validateOptions({ ...options, resolution: '../../' }));
  assert.throws(() => validateOptions({ ...options, encoder: 'nvenc;whoami' }));
  assert.throws(() => validateOptions({ ...options, parallel: 'yes' }));
  assert.deepEqual(validateOptions(options), options);
});
test('uses argument arrays and preserves path with quotes', () => {
  const args = buildArgs({ path: source, videoIndex: 0 }, options, path.join(directory, 'out.mp4'));
  assert.equal(args[args.indexOf('-i') + 1], source);
  assert.ok(args.includes('0:a:0?'));
  assert.match(args[args.indexOf('-vf') + 1], /min\(iw,854\)/);
  assert.equal(parseProgress('out_time_us=1500000\r', 3), 50);
  assert.equal(parseProgress('out_time_us=99999999', 3), 99);
  assert.equal(parseProgress('frame=30', 3), null);
  const limited = buildArgs({ path: source, videoIndex: 0 }, { ...options, codec: 'h265' }, 'limited.mp4', { cpuThreads: 4 });
  assert.equal(limited[limited.indexOf('-x265-params') + 1], 'pools=4:frame-threads=2');
  assert.throws(() => buildArgs({ path: source, videoIndex: 0 }, options, 'limited.mp4', { cpuThreads: -1 }));
});
test('compresses a real video and never overwrites a duplicate output', async () => {
  const job = await inspect(source);
  assert.equal(job.width, 640); assert.equal(job.height, 360); assert.ok(job.thumbnail.startsWith('data:image/jpeg;'));
  const progress = [];
  const result = await compress(job, options, directory, value => progress.push(value), new AbortController().signal);
  const output = await inspect(result.output);
  assert.ok(result.outputSize < job.size, `${result.outputSize} < ${job.size}`);
  assert.equal(output.width, 640); assert.equal(output.height, 360);
  assert.ok(Math.abs(output.duration - job.duration) < 0.2);
  const metadata = JSON.parse((await run(binaryPaths().ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', result.output])).toString());
  assert.ok(metadata.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(progress.length > 0);
  const original = await fs.readFile(result.output);
  const second = await compress(job, options, directory, () => {}, new AbortController().signal);
  assert.notEqual(second.output, result.output);
  assert.deepEqual(await fs.readFile(result.output), original);
  assert.equal((await fs.stat(source)).size, job.size);
});
test('H.265 MKV supports muted audio and real downscaling', async () => {
  const job = await inspect(source);
  const large = path.join(directory, 'vertical.mp4');
  await run(binaryPaths().ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=480x854:rate=12', '-t', '1', '-c:v', 'libx264', large]);
  const portrait = await inspect(large);
  const result = await compress(portrait, { ...options, codec: 'h265', format: 'mkv', audio: 'mute' }, directory, () => {}, new AbortController().signal, { cpuThreads: 2 });
  const output = await inspect(result.output);
  assert.equal(output.codec, 'hevc'); assert.ok(output.width <= 480); assert.ok(output.height <= 480);
  assert.ok(output.width % 2 === 0 && output.height % 2 === 0);
  const metadata = JSON.parse((await run(binaryPaths().ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', result.output])).toString());
  assert.ok(!metadata.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(Math.abs(output.width / output.height - portrait.width / portrait.height) < 0.02);
  assert.ok(job.size > 0);
});
test('cancelling an in-flight encoding removes partial output', async () => {
  const job = await inspect(source); const control = new AbortController();
  const promise = compress(job, { ...options, codec: 'h265', speed: 'slow' }, directory, () => {}, control.signal);
  const timer = setTimeout(() => control.abort(), 30);
  await assert.rejects(promise, /已取消/); clearTimeout(timer);
  assert.ok(!(await fs.readdir(directory)).some(name => name.includes('.partial.')));
});
test('rejects non-video files', async () => {
  const file = path.join(directory, 'invalid.txt'); await fs.writeFile(file, 'not a video');
  await assert.rejects(inspect(file));
});

test('auto chooses an encoder per codec and falls back to CPU only when unavailable', () => {
  const hardware = { encoders: [{ id: 'nvenc', codecs: ['h264'] }, { id: 'qsv', codecs: ['h264', 'h265'] }] };
  assert.equal(resolveEncoder({ ...options, encoder: 'auto' }, hardware).encoder, 'nvenc');
  assert.equal(resolveEncoder({ ...options, codec: 'h265', encoder: 'auto' }, hardware).encoder, 'qsv');
  assert.equal(resolveEncoder({ ...options, encoder: 'auto' }, { encoders: [] }).encoder, 'cpu');
  assert.throws(() => resolveEncoder({ ...options, codec: 'h265', encoder: 'nvenc' }, hardware), /当前无法编码/);
  const args = buildArgs({ path: source, videoIndex: 0 }, { ...options, encoder: 'nvenc' }, 'test.mp4');
  assert.ok(args.includes('h264_nvenc')); assert.ok(args.includes('-cq')); assert.ok(!args.includes('-crf'));
  const amdHEVC = buildArgs({ path: source, videoIndex: 0 }, { ...options, codec: 'h265', encoder: 'amf' }, 'test.mp4');
  assert.ok(amdHEVC.includes('-qp_p')); assert.ok(!amdHEVC.includes('-qp_b'), 'HEVC AMF has no qp_b option in bundled FFmpeg');
});

test('available hardware encoders produce playable H.264 and H.265 videos', async t => {
  const hardware = await detectHardware();
  const job = await inspect(source);
  let tested = 0;
  for (const encoder of hardware.encoders) for (const codec of encoder.codecs) {
    await t.test(`${encoder.label} ${codec}`, async () => {
      const result = await compress(job, { ...options, codec, encoder: encoder.id }, directory, () => {}, new AbortController().signal);
      const output = await inspect(result.output);
      assert.equal(output.codec, codec === 'h265' ? 'hevc' : 'h264');
      assert.equal(result.encoder, encoder.id); assert.ok(result.outputSize > 0);
      assert.ok(Math.abs(output.duration - job.duration) < 0.2);
    });
    tested++;
  }
  if (!tested) t.diagnostic('No usable GPU encoder on this host; CPU fallback verified separately.');
});
