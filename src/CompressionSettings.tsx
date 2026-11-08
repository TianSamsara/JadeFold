import { Settings2, RotateCcw, Info, ShieldCheck } from 'lucide-react'
import type { Options, Hardware } from './types'
import { QualityControls, DeviceControls, qualityNames, deviceNames } from './FriendlyControls'
import { modeOf, modes, selectMode, selectProfile, contentDefaults, actualEncoder } from './modes'
export { defaultOptions } from './modes'
export function CompressionSettings({ options: o, onChange, locked, hardware }: { options: Options; onChange: (value: Options) => void; locked: boolean; hardware: Hardware }) {
  const patch = <K extends keyof Options>(key: K, value: Options[K]) => onChange({ ...o, [key]: value })
  const mode = modeOf(o); const smart = mode === 'smart'; const compatible = mode === 'compatible'; const size = mode === 'size'; const classic = o.strategy === 'maruko'
  const gpu = !size && !classic; const actual = actualEncoder(o, hardware)
  return <aside className="settings-panel" aria-label="压缩设置">
    <div className="settings-heading"><Settings2 size={18} aria-hidden="true" /><h2>本次搭配</h2><button className="icon-button" title="恢复当前模式推荐搭配" aria-label="恢复推荐搭配" disabled={locked} onClick={() => onChange(selectMode(o, mode))}><RotateCcw size={16} /></button></div>
    <div className="output-plan" aria-label="输出方案摘要" aria-live="polite"><div><strong>{modes.find(m => m.id === mode)?.name}</strong><span>{smart ? '先试一小段' : size ? '按大小压缩' : '按画质压缩'}</span></div><dl>
      {smart && <div><dt>画质</dt><dd>{qualityNames[o.qualityPreference]}</dd></div>}<div><dt>视频</dt><dd>{smart ? o.smartCodec === 'hevc' ? '允许 H.265' : 'H.264 / H.265 随原片' : `${o.codec === 'h265' ? 'H.265' : 'H.264'} / ${o.bitDepth}bit`}</dd></div>
      <div><dt>画面</dt><dd>{smart || o.resolution === 'original' ? '原分辨率' : `最高 ${o.resolution}p`} · 原帧率</dd></div>
      <div><dt>声音</dt><dd>{smart || o.audio === 'copy' ? '复制原音轨' : o.audio === 'mute' ? '移除声音' : `AAC ${o.audioKbps} kbps`}</dd></div>
      <div><dt>执行</dt><dd>{hardware.detecting && gpu ? '检测显卡中…' : smart ? o.encoder === 'cpu' ? '使用 CPU' : o.encoder === 'auto' ? '优先显卡，每个视频单独检查' : deviceNames[o.encoder] : deviceNames[actual]}{gpu && o.parallel && actual !== 'cpu' ? ' + CPU 并行' : ''}</dd></div>
      <div><dt>体积</dt><dd>{smart ? '实际缩小 ≥ 5% 才导出' : size ? `每个文件约 ${Number.isFinite(o.targetMB) ? o.targetMB : '—'} MB` : '取决于画面与画质设置'}</dd></div>
    </dl></div>
    <fieldset disabled={locked} className="settings-fieldset"><legend className="sr-only">视频压缩参数</legend>
      {!size && <QualityControls options={o} onChange={onChange} />}
      <DeviceControls options={o} onChange={onChange} hardware={hardware} />
      {!compatible && <div className="setting-block"><label className="form-label">画面内容<select aria-label="素材类型" value={o.content} onChange={e => { const content = e.target.value as Options['content']; onChange({ ...o, content, ...(o.strategy === 'efficient' && !size ? { ...contentDefaults(content), ...(o.encoder !== 'cpu' ? { bitDepth: '8' as const } : {}) } : {}) }) }}><option value="general">日常实拍 / 手机视频</option><option value="animation">动漫 / 二次元</option><option value="screen">录屏 / 教程文字</option></select></label><p className="field-hint">{o.content === 'screen' ? smart ? '更重视小字清晰度，不缩小画面尺寸。' : '建议保持原分辨率，优先检查小字是否清晰。' : o.content === 'animation' ? classic ? '经典方案保留小丸参数，不额外叠加动漫调优。' : actual !== 'cpu' ? '显卡会按所选画质压缩，CPU 的动漫专用参数不适用于显卡。' : '选择 CPU 时会使用适合动漫的参数，减少线条和颜色层次的损失。' : '通用设置，不自动降噪或降低帧率。'}</p></div>}
      {smart ? <>
        <label className="form-label">怎么保存视频<select aria-label="智能编码兼容性" value={o.smartCodec} onChange={e => patch('smartCodec', e.target.value as Options['smartCodec'])}><option value="preserve">随原片选择 H.264 / H.265 · 推荐</option><option value="hevc">尝试更省空间的 H.265</option></select></label>
        <p className="field-hint">H.265 需要播放器支持 HEVC。解决原片播放问题，请选「兼容播放」。</p>
        <div className="smart-policy"><ShieldCheck size={18} aria-hidden="true" /><div><strong>缩不动，就保留原片</strong><p>多点试压达标且预计缩小 ≥ 10% 才完整编码；实际缩小不足 5% 不导出。</p></div></div>
        <details className="advanced-settings"><summary>更多设置与分析说明</summary><label className="form-label">输出格式<select aria-label="输出格式" value={o.format} onChange={e => patch('format', e.target.value as Options['format'])}><option value="mp4">MP4</option><option value="mkv">MKV</option></select></label><p className="field-hint">从原片抽取短片，按你选择的细节要求比较画面。更重视细节时要求更严格。抽样不能保证每个镜头都完全无损。</p><p className="field-hint">HDR、多音轨、字幕等特殊素材会跳过；临时采样会占用磁盘空间。</p></details>
      </> : <>
        {size ? <div className="setting-block"><label className="form-label">每个视频的目标大小（MB）<input aria-label="目标大小 MB" type="number" min="0.1" max="102400" step="0.1" value={Number.isFinite(o.targetMB) ? o.targetMB : ''} onChange={e => patch('targetMB', e.target.value === '' ? NaN : Number(e.target.value))} aria-invalid={!Number.isFinite(o.targetMB) || o.targetMB < 0.1 || o.targetMB > 102400} /></label>{(!Number.isFinite(o.targetMB) || o.targetMB < 0.1 || o.targetMB > 102400) && <p className="inline-error" role="alert">请输入 0.1–102400 MB。</p>}<div className="size-shortcuts">{[25, 50, 100].map(n => <button key={n} aria-pressed={o.targetMB === n} onClick={() => patch('targetMB', n)}>{n} MB</button>)}</div><p className="field-hint">这是每个文件的目标，不是整个队列总量。1 MB = 1024² 字节；有严格上传上限时请留余量。</p></div> : null}
        {!compatible && <div className="form-grid"><label>视频保存方式<select aria-label="视频编码" disabled={classic} value={o.codec} onChange={e => onChange({ ...o, codec: e.target.value as Options['codec'], bitDepth: '8', ...(gpu ? { encoder: o.encoder === 'cpu' ? 'cpu' : 'auto', parallel: false } : {}) })}><option value="h264">H.264 · 通用</option><option value="h265">H.265 · 省空间</option></select></label><label>输出格式<select aria-label="输出格式" value={o.format} onChange={e => patch('format', e.target.value as Options['format'])}><option value="mp4">MP4</option><option value="mkv">MKV</option></select></label></div>}
        {!compatible && <p className="field-hint">{o.codec === 'h265' ? 'H.265 通常更省空间，需要播放器支持 HEVC；播放不了时可选「兼容播放」。' : 'H.264 适合发送分享，更多播放器能打开；从 H.265 转过来可能变大。'}</p>}
        {compatible && <div className="cpu-note"><Info size={17} aria-hidden="true" /><p>已固定 MP4 / H.264 / 8bit / AAC。可调整画质、加速与分辨率；转码不以缩小体积为保证。</p></div>}
        <details className="advanced-settings" key={mode}><summary>更多设置{classic ? ' · 小丸经典参考' : ''}</summary>
          {(mode === 'quality' || size) && <><label className="form-label">编码方案<select aria-label="编码方案" value={o.strategy} onChange={e => onChange(selectProfile(o, e.target.value as 'efficient' | 'maruko'))}><option value="efficient">普通方案 · 可选 CPU 或显卡</option><option value="maruko">小丸经典参考 · x264</option></select></label><p className="field-hint">小丸参考固定 H.264、8bit、veryslow；使用本程序内置 x264，不等同原小丸所有版本。</p></>}
          {!compatible && <label className="form-label">色深<select aria-label="色深" value={o.bitDepth} disabled={o.codec !== 'h265' || actual !== 'cpu' || classic || o.encoder !== 'cpu'} onChange={e => patch('bitDepth', e.target.value as Options['bitDepth'])}><option value="8">常用颜色层次 · 8bit</option><option value="10">更多颜色层次 · 10bit（CPU）</option></select></label>}
          <label className="form-label">画面尺寸<select aria-label="分辨率" value={o.resolution} onChange={e => patch('resolution', e.target.value as Options['resolution'])}><option value="original">保持原尺寸 · 更利于保留细节</option><option value="1080">最高 1080p</option><option value="720">最高 720p</option><option value="480">最高 480p</option></select></label>
          <label className="form-label">愿意花多少时间<select aria-label="编码速度" disabled={classic} value={o.speed} onChange={e => patch('speed', e.target.value as Options['speed'])}>{(o.encoder === 'cpu' ? ['fast', 'medium', 'slow', 'slower', 'veryslow'] : ['fast', 'medium', 'slow']).map(v => <option key={v} value={v}>{{ fast: '尽快完成', medium: '时间和大小适中', slow: '多花一点时间，争取更小', slower: '更仔细分析，耗时更长', veryslow: '最仔细分析，耗时最多' }[v]}</option>)}</select></label>
          {!compatible && <label className="form-label">音频处理<select aria-label="音频处理" value={o.audio} onChange={e => patch('audio', e.target.value as Options['audio'])}><option value="keep">转换为通用声音格式（AAC）</option><option value="copy">保留原来的声音，不再压缩</option><option value="mute">移除声音</option></select></label>}
          {o.audio === 'keep' && <label className="form-label">音频码率<select aria-label="音频码率" value={o.audioKbps} onChange={e => patch('audioKbps', Number(e.target.value))}>{[64, 96, 128, 160, 192, 256, 320].map(n => <option key={n} value={n}>{n} kbps</option>)}</select></label>}
          <p className="field-hint">手动模式处理第一路视频与音频，字幕和其他音轨不保留。HDR 暂不做色调映射。10bit 不会恢复已丢失的细节。</p>
        </details>
      </>}
    </fieldset>
  </aside>
}
