const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function binaryPaths() {
  const unpack = value => value.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return { ffmpeg: unpack(require('ffmpeg-static')), ffprobe: unpack(require('ffprobe-static').path) };
}

function run(executable, args, { timeout = 30000, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false });
    const chunks = []; let bytes = 0; let error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('读取视频超时，请检查文件是否可正常播放。')); }, timeout);
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { child.kill(); reject(new Error('视频信息过大，无法读取。')); }
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
    child.on('error', err => { clearTimeout(timer); reject(new Error(`无法启动视频引擎：${err.message}`)); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error || '无法读取此视频，请确认文件完整且格式受支持。')); });
  });
}

async function inspect(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('请选择本地视频文件。');
  if (!['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv', '.ts', '.mts', '.m2ts'].includes(path.extname(input).toLowerCase())) throw new Error('不支持此文件类型，请添加 MP4、MOV、MKV 等视频文件。');
  const resolved = await fs.realpath(input);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('请添加视频文件，暂不支持直接导入文件夹。');
  const tools = binaryPaths();
  const raw = await run(tools.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-show_streams', '-of', 'json', resolved]);
  const data = JSON.parse(raw.toString());
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('此文件没有可压缩的视频画面。');
  const duration = Number(data.format?.duration || video.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法识别视频时长，请尝试完整的本地视频。');
  let thumbnail = '';
  try {
    const image = await run(tools.ffmpeg, ['-v', 'error', '-ss', String(Math.min(duration / 4, 2)), '-protocol_whitelist', 'file,pipe', '-i', resolved, '-map', `0:${video.index}`, '-frames:v', '1', '-vf', 'scale=240:135:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], { timeout: 15000 });
    thumbnail = `data:image/jpeg;base64,${image.toString('base64')}`;
  } catch { /* A failed thumbnail should not prevent compression. */ }
  const [numerator, denominator] = (video.avg_frame_rate || '0/1').split('/').map(Number);
  return { id: randomUUID(), path: resolved, name: path.basename(resolved), size: stat.size, duration, width: video.width, height: video.height, videoIndex: video.index, fps: denominator ? numerator / denominator : 0, codec: video.codec_name, thumbnail, status: 'queued', progress: 0 };
}

function validateOptions(value) {
  const options = { codec: value?.codec, format: value?.format, resolution: value?.resolution, crf: Number(value?.crf), speed: value?.speed, audio: value?.audio, encoder: value?.encoder ?? 'cpu', parallel: value?.parallel ?? false };
  if (!['h264', 'h265'].includes(options.codec) || !['mp4', 'mkv'].includes(options.format)
    || !['original', '1080', '720', '480'].includes(options.resolution)
    || !Number.isInteger(options.crf) || options.crf < 18 || options.crf > 35
    || !['fast', 'medium', 'slow'].includes(options.speed) || !['keep', 'mute'].includes(options.audio)
    || !['auto', 'cpu', 'nvenc', 'qsv', 'amf'].includes(options.encoder) || typeof options.parallel !== 'boolean') {
    throw new Error('压缩设置无效，请重新选择预设。');
  }
  return options;
}

const encoderNames = { cpu: 'CPU 软件编码', nvenc: 'NVIDIA NVENC', qsv: 'Intel Quick Sync', amf: 'AMD AMF' };

function videoEncoderArgs(options) {
  const o = validateOptions(options);
  const codec = o.codec === 'h265' ? 'hevc' : 'h264';
  if (o.encoder === 'auto') throw new Error('请先完成硬件检测并选择编码器。');
  if (o.encoder === 'cpu') return ['-c:v', o.codec === 'h265' ? 'libx265' : 'libx264', '-crf', String(o.crf), '-preset', o.speed];
  if (o.encoder === 'nvenc') return ['-c:v', `${codec}_nvenc`, '-preset', { fast: 'p3', medium: 'p5', slow: 'p7' }[o.speed], '-rc', 'vbr', '-cq', String(o.crf), '-b:v', '0'];
  if (o.encoder === 'qsv') return ['-c:v', `${codec}_qsv`, '-preset', o.speed, '-global_quality', String(o.crf), '-b:v', '0'];
  const args = ['-c:v', `${codec}_amf`, '-quality', { fast: 'speed', medium: 'balanced', slow: 'quality' }[o.speed], '-rc', 'cqp', '-qp_i', String(o.crf), '-qp_p', String(o.crf)];
  if (o.codec === 'h264') args.push('-qp_b', String(o.crf));
  return args;
}

function resolveEncoder(options, hardware) {
  const o = validateOptions(options);
  const supports = id => hardware.encoders?.some(item => item.id === id && item.codecs.includes(o.codec));
  if (o.encoder === 'auto') return { ...o, encoder: ['nvenc', 'qsv', 'amf'].find(supports) || 'cpu' };
  if (o.encoder !== 'cpu' && !supports(o.encoder)) throw new Error(`${encoderNames[o.encoder]} 当前无法编码 ${o.codec === 'h265' ? 'H.265' : 'H.264'}，请选择自动或 CPU 编码。`);
  return o;
}

async function detectHardware() {
  // Verify actual encoding with this driver, not merely FFmpeg's compiled encoder list.
  const encoders = await Promise.all(['nvenc', 'qsv', 'amf'].map(async id => {
    const results = await Promise.all(['h264', 'h265'].map(async codec => {
      try {
        const options = { codec, encoder: id, format: 'mp4', resolution: 'original', crf: 26, speed: 'medium', audio: 'mute' };
        await run(binaryPaths().ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '3', '-an', ...videoEncoderArgs(options), '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { timeout: 12000 });
        return { codec, available: true };
      } catch (error) { return { codec, available: false, reason: error.message.slice(-500) }; }
    }));
    return { id, label: encoderNames[id], codecs: results.filter(result => result.available).map(result => result.codec), errors: results.filter(result => !result.available).map(result => ({ codec: result.codec, reason: result.reason })) };
  }));
  return { detecting: false, encoders };
}

function buildArgs(job, options, output, runtime = {}) {
  const o = validateOptions(options);
  const limited = runtime.cpuThreads;
  if (limited !== undefined && (!Number.isInteger(limited) || limited < 1 || limited > 256)) throw new Error('CPU 线程预算无效。');
  const args = ['-hide_banner', '-nostdin', '-n'];
  if (limited) args.push('-threads', String(limited), '-filter_threads', String(Math.min(2, limited)));
  args.push('-protocol_whitelist', 'file,pipe', '-i', job.path, '-map', `0:${job.videoIndex}`, '-map', '0:a:0?', '-sn', '-dn', ...videoEncoderArgs(o), '-pix_fmt', 'yuv420p');
  if (o.encoder === 'cpu' && limited) {
    args.push('-threads', String(limited));
    if (o.codec === 'h265') args.push('-x265-params', `pools=${limited}:frame-threads=${Math.min(2, limited)}`);
  }
  const filter = o.resolution === 'original'
    ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    : `scale=w='min(iw,${o.resolution === '1080' ? 1920 : o.resolution === '720' ? 1280 : 854})':h='min(ih,${o.resolution})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  args.push('-vf', filter);
  if (o.codec === 'h265') args.push('-tag:v', 'hvc1');
  if (o.audio === 'mute') args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '128k');
  if (o.format === 'mp4') args.push('-movflags', '+faststart');
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}

function parseProgress(line, duration) {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  return match ? Math.min(99, Math.max(0, Number(match[1]) / 1e6 / duration * 100)) : null;
}

async function publishOutput(temp, directory, name, extension) {
  const stem = path.parse(name).name;
  for (let i = 0; i < 10000; i++) {
    const output = path.join(directory, `${stem}_compressed${i ? ` (${i})` : ''}.${extension}`);
    try {
      await fs.copyFile(temp, output, require('node:fs').constants.COPYFILE_EXCL);
      return output;
    } catch (err) { if (err.code !== 'EEXIST') throw err; }
  }
  throw new Error('同名输出文件过多，请更换输出目录。');
}

async function compress(job, options, directory, onProgress, signal, runtime = {}) {
  const o = validateOptions(options);
  await fs.mkdir(directory, { recursive: true });
  const temp = path.join(directory, `.frame-${randomUUID()}.partial.${o.format}`);
  try {
    await new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error('已取消'));
      const child = spawn(binaryPaths().ffmpeg, buildArgs(job, o, temp, runtime), { windowsHide: true, shell: false });
      let pending = ''; let error = '';
      const abort = () => child.kill();
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', chunk => {
        pending += chunk.toString();
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) { const progress = parseProgress(line, job.duration); if (progress !== null) onProgress(progress); }
      });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-4000); });
      child.on('error', err => { signal.removeEventListener('abort', abort); reject(new Error(`视频引擎启动失败：${err.message}`)); });
      child.on('close', code => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(new Error('已取消'));
        else if (code !== 0) reject(new Error(`压缩失败，请检查文件或输出磁盘空间。\n${error.slice(-1200)}`));
        else resolve();
      });
    });
    if (signal.aborted) throw new Error('已取消');
    const output = await publishOutput(temp, directory, job.name, o.format);
    const stat = await fs.stat(output);
    return { output, outputSize: stat.size, completedAt: new Date().toISOString(), options: o, encoder: o.encoder, encoderLabel: encoderNames[o.encoder] };
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
}

module.exports = { binaryPaths, run, inspect, validateOptions, videoEncoderArgs, resolveEncoder, detectHardware, encoderNames, buildArgs, parseProgress, publishOutput, compress };
