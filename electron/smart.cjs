const fs = require('node:fs/promises');
const path = require('node:path');
const { binaryPaths, run, probeMedia, compress, validateOptions } = require('./engine.cjs');

const CRFS = [18, 20, 22, 24, 26, 28, 30, 32];
const POLICY = { vmaf: 93, lowerTailVmaf: 85, ssim: 0.97, estimatedSaving: 0.10, actualSaving: 0.05 };

function sampleWindows(duration) {
  if (!Number.isFinite(duration) || duration < 0.75) return [];
  const length = Math.min(duration, duration < 15 ? 4 : 3);
  const positions = duration < 15 ? [Math.max(0, (duration - length) / 2)] : [0.1, 0.5, 0.85].map(ratio => Math.min(duration - length, duration * ratio));
  return positions.map(start => ({ start, duration: length }));
}

function passesQuality(metrics, content = 'general') {
  const minSSIM = content === 'screen' ? 0.985 : POLICY.ssim;
  return metrics.length > 0 && metrics.every(item => Number.isFinite(item.vmaf) && item.vmaf >= POLICY.vmaf && Number.isFinite(item.lowerTailVmaf) && item.lowerTailVmaf >= POLICY.lowerTailVmaf && Number.isFinite(item.ssim) && item.ssim >= minSSIM);
}

function estimateSize(metrics, job) {
  const average = metrics.reduce((sum, item) => sum + item.videoBitrate, 0) / metrics.length;
  return Math.ceil((average * 1.10 + (job.hasAudio ? job.audioBitrate : 0)) * job.duration / 8 * 1.01);
}

function chooseBalanced(candidates, job, content) {
  return candidates.filter(candidate => candidate.verified && passesQuality(candidate.metrics, content) && candidate.estimatedSize <= job.size * (1 - POLICY.estimatedSaving))
    .sort((a, b) => a.estimatedSize - b.estimatedSize)[0] || null;
}

function unsupportedReason(job, o) {
  if (['smpte2084', 'arib-std-b67'].includes(job.colorTransfer)) return 'HDR 素材暂不使用当前 SDR 画质模型自动选参，请保留原片或使用手动模式。';
  if ((job.videoStreams || 1) > 1 || (job.audioStreams || 0) > 1 || job.subtitleStreams || job.attachmentStreams) return '原片包含多路视频、音轨、字幕或附件，智能模式不会通过丢弃这些内容缩小体积，请使用手动模式。';
  if (job.width % 2 || job.height % 2) return '原片使用特殊奇数分辨率，智能模式不自动裁切画面，请使用手动模式。';
  if (job.fieldOrder && !['progressive', 'unknown'].includes(job.fieldOrder)) return '隔行素材暂不自动选参，请使用手动模式。';
  if (/12|16/.test(job.pixelFormat || '')) return '当前智能方案不降低 12bit / 16bit 素材的色深，请使用手动模式。';
  if (!['yuv420p', 'yuvj420p', 'yuv420p10le'].includes(job.pixelFormat)) return '当前智能方案仅支持 4:2:0 视频，不自动降低其他色度格式或移除透明通道，请使用手动模式。';
  if (/10/.test(job.pixelFormat || '') && job.codec !== 'hevc' && o.smartCodec === 'preserve') return '当前兼容方案不自动降低原片的 10bit 色深；可允许 H.265 或使用手动模式。';
  if (job.hasAudio && (!job.audioBitrate || !Number.isFinite(job.audioBitrate))) return '无法可靠读取原音轨码率，暂不自动估算体积，请使用手动模式。';
  if (job.hasAudio && o.format === 'mp4' && !['aac', 'mp3', 'ac3', 'eac3', 'alac'].includes(job.audioCodec)) return '原音轨与 MP4 不兼容；智能模式不重复有损编码音频，请选择 MKV 或使用手动模式。';
  if (!sampleWindows(job.duration).length) return '视频太短，无法可靠试压，已保留原片。';
  return '';
}

async function measureQuality(reference, encoded, work, signal, expectedFrames) {
  const filter = '[0:v]settb=1/25,setpts=N,format=yuv420p,split=2[d1][d2];[1:v]settb=1/25,setpts=N,format=yuv420p,split=2[r1][r2];[d1][r1]libvmaf=log_fmt=json:log_path=vmaf.json:n_threads=2[v];[d2][r2]ssim=stats_file=ssim.log[s]';
  await run(binaryPaths().ffmpeg, ['-v', 'error', '-nostdin', '-threads', '2', '-i', encoded, '-threads', '2', '-i', reference, '-filter_complex_threads', '2', '-filter_complex', filter, '-map', '[v]', '-map', '[s]', '-an', '-fps_mode:v', 'passthrough', '-f', 'null', '-'], { cwd: work, signal, timeout: 180000 });
  const scores = JSON.parse(await fs.readFile(path.join(work, 'vmaf.json'), 'utf8'));
  const frames = scores.frames?.map(frame => frame.metrics?.vmaf).filter(Number.isFinite).sort((a, b) => a - b);
  const ssim = [...(await fs.readFile(path.join(work, 'ssim.log'), 'utf8')).matchAll(/All:([0-9.]+)/g)].map(match => Number(match[1]));
  if (!frames?.length || !ssim.length || !Number.isFinite(scores.pooled_metrics?.vmaf?.mean)) throw new Error('画质评分未生成可靠结果');
  if (expectedFrames && (frames.length !== expectedFrames || ssim.length !== expectedFrames)) throw new Error('参考与输出帧数不一致，不能可靠比较画质');
  return { vmaf: scores.pooled_metrics.vmaf.mean, lowerTailVmaf: frames[Math.floor((frames.length - 1) * 0.05)], ssim: ssim.reduce((sum, value) => sum + value, 0) / ssim.length, frames: ssim.length };
}

async function planBalanced(job, options, directory, onUpdate, signal, runtime = {}) {
  const o = validateOptions(options);
  const assessment = { decision: 'analysing', samples: sampleWindows(job.duration), candidates: [], policy: POLICY, sourceCodec: job.codec, sourceVideoBitrate: job.videoBitrate || 0, sourceTotalBitrate: job.totalBitrate || job.size * 8 / job.duration };
  const update = (phase, progress) => onUpdate({ ...assessment, phase, progress });
  const skip = reason => ({ ...assessment, decision: 'skip', reason });
  if (signal.aborted) throw new Error('已取消');
  const reason = unsupportedReason(job, o);
  if (reason) return skip(reason);
  const destination = path.resolve(directory); await fs.mkdir(destination, { recursive: true });
  const work = await fs.mkdtemp(path.join(destination, '.jadefold-smart-'));
  const cpuThreads = runtime.cpuThreads || 4;
  const codec = o.smartCodec === 'hevc' || job.codec === 'hevc' ? 'h265' : 'h264';
  const base = { ...o, strategy: 'efficient', codec, encoder: 'cpu', parallel: false, rateControl: 'quality', resolution: 'original', speed: 'slow', bitDepth: codec === 'h265' && /10/.test(job.pixelFormat || '') ? '10' : '8', audio: job.hasAudio ? 'copy' : 'mute' };
  try {
    const references = [];
    for (let i = 0; i < assessment.samples.length; i++) {
      update(`采样 ${i + 1} / ${assessment.samples.length}：保持原分辨率和帧率`, 1 + i);
      const window = assessment.samples[i]; const reference = path.join(work, `reference-${i}.mkv`);
      await run(binaryPaths().ffmpeg, ['-v', 'error', '-nostdin', '-threads', String(cpuThreads), '-ss', String(window.start), '-protocol_whitelist', 'file,pipe', '-i', job.path, '-t', String(window.duration), '-map', `0:${job.videoIndex}`, '-an', '-c:v', 'ffv1', reference], { signal, timeout: 180000 });
      const metadata = await probeMedia(reference, { signal, countFrames: true });
      references.push({ path: reference, size: (await fs.stat(reference)).size, name: `sample-${i}.mkv`, ...metadata });
    }
    const cache = new Map(); let measured = 0;
    async function trial(crf, index) {
      const key = `${crf}-${index}`;
      if (cache.has(key)) return cache.get(key);
      update(`试压 ${codec.toUpperCase()} CRF ${crf}，片段 ${index + 1} / ${references.length}`, Math.min(14, 4 + measured));
      const settings = { ...base, crf, audio: 'mute' };
      const encoded = await compress(references[index], settings, work, () => {}, signal, { cpuThreads, preserveFrames: true });
      if (encoded.outputFrameCount && encoded.outputFrameCount !== references[index].frameCount) throw new Error('试压改变了帧数，已停止自动选参');
      const metricDirectory = path.join(work, `metric-${key}`); await fs.mkdir(metricDirectory);
      update(`测量画质：CRF ${crf}，片段 ${index + 1} / ${references.length}`, Math.min(14, 4 + measured));
      const metrics = await measureQuality(references[index].path, encoded.output, metricDirectory, signal, references[index].frameCount);
      const result = { ...metrics, videoBitrate: encoded.outputVideoBitrate || encoded.outputSize * 8 / references[index].duration };
      cache.set(key, result); measured++;
      await fs.rm(encoded.output, { force: true });
      return result;
    }
    const calibration = Math.floor(references.length / 2);
    let low = 0; let high = CRFS.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2); const crf = CRFS[middle];
      const metrics = await trial(crf, calibration);
      assessment.candidates.push({ crf, metrics: [metrics], estimatedSize: estimateSize([metrics], job), verified: references.length === 1 });
      if (passesQuality([metrics], o.content)) low = middle + 1;
      else high = middle - 1;
    }
    const candidates = assessment.candidates.filter(candidate => passesQuality(candidate.metrics, o.content)).sort((a, b) => a.estimatedSize - b.estimatedSize);
    for (const candidate of candidates) {
      const all = [];
      for (let index = 0; index < references.length; index++) all.push(await trial(candidate.crf, index));
      candidate.metrics = all; candidate.estimatedSize = estimateSize(all, job); candidate.verified = true;
      const chosen = chooseBalanced([candidate], job, o.content);
      if (chosen) {
        const selected = { ...base, crf: chosen.crf };
        update(`已选择 ${codec.toUpperCase()} CRF ${chosen.crf}，准备完整编码`, 15);
        return { ...assessment, decision: 'encode', options: selected, estimatedSize: chosen.estimatedSize, estimatedSaving: 1 - chosen.estimatedSize / job.size, minVmaf: Math.min(...all.map(item => item.vmaf)), minSSIM: Math.min(...all.map(item => item.ssim)), reason: '抽样画质达标，预计至少缩小 10%；完整输出仍会检查实际体积。' };
      }
    }
    return skip('已测试的参数无法同时满足画质门槛和预计至少 10% 的缩小目标，建议保留原片。');
  } catch (error) {
    if (signal.aborted) throw new Error('已取消');
    return skip(`智能分析未能完成，已保留原片；没有自动采用未经评分的参数。${error.message.slice(0, 180)}`);
  } finally {
    if (path.dirname(work) === destination && path.basename(work).startsWith('.jadefold-smart-')) await fs.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }
}

module.exports = { POLICY, CRFS, sampleWindows, passesQuality, estimateSize, chooseBalanced, measureQuality, planBalanced };
