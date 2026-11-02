const fs = require('node:fs/promises');
const path = require('node:path');
const engine = require('../electron/engine.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.test-artifacts/benchmark', String(Date.now()));
const base = { encoder: 'cpu', codec: 'h264', format: 'mp4', resolution: 'original', crf: 24, speed: 'veryslow', audio: 'mute', parallel: false, strategy: 'maruko', content: 'general', rateControl: 'size', targetMB: 0.12, bitDepth: '8', audioKbps: 128 };
async function metrics(reference, output, name) {
  const work = path.join(directory, name); await fs.mkdir(work, { recursive: true });
  const normalize = '[0:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[r];';
  await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-i', output, '-i', reference, '-lavfi', `${normalize}[d][r]libvmaf=log_fmt=json:log_path=vmaf.json:n_threads=2`, '-an', '-f', 'null', '-'], { cwd: work, timeout: 120000 });
  await engine.run(engine.binaryPaths().ffmpeg, ['-v', 'error', '-i', output, '-i', reference, '-lavfi', `${normalize}[d][r]ssim=stats_file=ssim.log`, '-an', '-f', 'null', '-'], { cwd: work, timeout: 120000 });
  const vmaf = JSON.parse(await fs.readFile(path.join(work, 'vmaf.json'), 'utf8'));
  const ssim = [...(await fs.readFile(path.join(work, 'ssim.log'), 'utf8')).matchAll(/All:([0-9.]+)/g)].map(match => Number(match[1]));
  if (!ssim.length || !Number.isFinite(vmaf.pooled_metrics?.vmaf?.mean)) throw new Error('Quality measurement did not produce valid metrics');
  return { vmaf: vmaf.pooled_metrics.vmaf.mean, ssim: ssim.reduce((a, b) => a + b, 0) / ssim.length, measuredFrames: ssim.length };
}
(async () => {
  await fs.mkdir(directory, { recursive: true });
  const content = process.argv.find(value => value.startsWith('--content='))?.split('=')[1] || 'general';
  if (!['general', 'animation', 'screen'].includes(content)) throw new Error('Use --content=general, animation, or screen');
  const supplied = process.argv.slice(2).filter(value => value !== '--' && !value.startsWith('--content='));
  const sources = [];
  if (supplied.length) {
    for (const file of supplied) {
      const input = path.resolve(file); const reference = path.join(directory, `reference-${sources.length}.mkv`);
      await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-i', input, '-t', '6', '-map', '0:v:0', '-an', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'ffv1', reference], { timeout: 120000 });
      sources.push({ name: path.basename(input), reference, content, synthetic: false });
    }
  } else {
    await fs.copyFile('C:/Windows/Fonts/consola.ttf', path.join(directory, 'font.ttf'));
    const fixtures = [
      { name: 'general-stress', content: 'general', filter: 'testsrc2=size=640x360:rate=24,noise=alls=6:allf=t+u' },
      { name: 'animation-edges', content: 'animation', filter: 'testsrc2=size=640x360:rate=24,edgedetect=low=0.08:high=0.2:mode=colormix' },
      { name: 'screen-text', content: 'screen', filter: "color=c=0xeff3eb:s=640x360:r=24,drawgrid=w=80:h=60:t=1:c=0xced8c5,drawtext=fontfile=font.ttf:text='JadeFold Screen Test 0123456789':x=20:y=40:fontsize=24:fontcolor=0x234338,drawtext=fontfile=font.ttf:text='Small code abcdefghijk':x=20:y=100:fontsize=14:fontcolor=0x171f1c,drawtext=fontfile=font.ttf:text='Frame %{n}':x=20:y=180:fontsize=24:fontcolor=0x234338" },
    ];
    for (const fixture of fixtures) {
      const reference = path.join(directory, `${fixture.name}.mkv`);
      await engine.run(engine.binaryPaths().ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', fixture.filter, '-t', '3', '-an', '-c:v', 'ffv1', reference], { cwd: directory });
      sources.push({ ...fixture, reference, synthetic: true });
    }
  }
  const rows = [];
  for (const fixture of sources) {
    const job = await engine.inspect(fixture.reference);
    for (const variant of ['classic-reference', 'h265-10bit']) {
      const settings = variant === 'classic-reference' ? base : { ...base, strategy: 'efficient', codec: 'h265', bitDepth: '10', content: fixture.content, speed: 'slow' };
      const started = performance.now();
      const encoded = await engine.compress(job, settings, directory, () => {}, new AbortController().signal, { cpuThreads: 4 });
      const seconds = (performance.now() - started) / 1000;
      const scores = await metrics(fixture.reference, encoded.output, `${fixture.name.replace(/[^a-zA-Z0-9-]/g, '_')}-${variant}`);
      const row = { sample: fixture.name, synthetic: fixture.synthetic, variant, targetBytes: settings.targetMB * 1024 * 1024, bytes: encoded.outputSize, seconds, width: job.width, height: job.height, ...scores };
      rows.push(row); console.log(JSON.stringify(row));
    }
  }
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ note: 'Same-resolution short-clip tests; classic parameters are reproduced with bundled libx264, not original Maruko binaries. Synthetic clips do not establish real-world parity.', rows }, null, 2));
  console.log(`Report saved: ${path.join(directory, 'report.json')}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
