import type { CSSProperties } from 'react'
import { Settings2, Info, Clapperboard, SlidersHorizontal, ArrowDownToLine } from 'lucide-react'
import type { Options, Encoder, Hardware } from './types'

export const defaultOptions: Options = { codec: 'h265', format: 'mp4', resolution: 'original', crf: 24, speed: 'slow', audio: 'keep', encoder: 'cpu', parallel: false, strategy: 'efficient', content: 'general', rateControl: 'quality', targetMB: 50, bitDepth: '10', audioKbps: 160 }

const encoders: { id: Encoder; label: string }[] = [{ id: 'nvenc', label: 'NVIDIA NVENC' }, { id: 'qsv', label: 'Intel Quick Sync' }, { id: 'amf', label: 'AMD AMF' }]
function recommend(content: Options['content']): Partial<Options> {
  return content === 'screen' ? { codec: 'h264', bitDepth: '8', crf: 18, resolution: 'original' }
    : { codec: 'h265', bitDepth: '10', crf: content === 'animation' ? 22 : 24, resolution: 'original' }
}

export function CompressionSettings({ options: o, onChange, locked, hardware }: { options: Options; onChange: (value: Options) => void; locked: boolean; hardware: Hardware }) {
  const patch = <K extends keyof Options>(key: K, value: Options[K]) => onChange({ ...o, [key]: value })
  const available = (id: Encoder) => hardware.encoders.some(item => item.id === id && item.codecs.includes(o.codec))
  const actual = o.encoder === 'auto' ? encoders.find(item => available(item.id))?.id || 'cpu' : o.encoder
  const actualLabel = encoders.find(item => item.id === actual)?.label || 'CPU 软件编码'
  const fixedCPU = o.strategy !== 'standard' || o.rateControl === 'size'
  const unavailable = o.encoder !== 'auto' && o.encoder !== 'cpu' && !available(o.encoder)
  const qualityValue = actual === 'cpu' || actual === 'nvenc' ? o.crf : Math.round(o.crf)
  const qualityUnit = { auto: 'CRF', cpu: 'CRF', nvenc: 'CQ', qsv: 'ICQ', amf: 'QP' }[actual]
  const values = o.strategy === 'standard' ? [21, 26, 31] : [20, 24, 28]
  const presets = [{ name: '画质优先', desc: '保留更多画面细节', icon: Clapperboard }, { name: '均衡压缩', desc: '兼顾清晰度与文件大小', icon: SlidersHorizontal }, { name: '体积优先', desc: '方便传输与日常分享', icon: ArrowDownToLine }]
  function strategy(value: Options['strategy']) {
    if (value === 'standard') onChange({ ...o, strategy: value, encoder: 'auto', codec: 'h264', bitDepth: '8', speed: 'medium', crf: 26, rateControl: 'quality', parallel: false })
    else if (value === 'maruko') onChange({ ...o, strategy: value, encoder: 'cpu', codec: 'h264', bitDepth: '8', speed: 'veryslow', crf: 23.5, parallel: false })
    else onChange({ ...o, ...recommend(o.content), strategy: value, encoder: 'cpu', speed: 'slow', parallel: false })
  }
  return <aside className="settings-panel" aria-label="压缩设置">
    <div className="settings-heading"><Settings2 size={18} /><h2>压缩设置</h2><span>应用于待处理视频</span></div>
    <fieldset disabled={locked} className="settings-fieldset"><legend className="sr-only">视频压缩参数</legend>
      <div className="quality-strategy">
        <label className="form-label">编码方案<select aria-label="编码方案" value={o.strategy} onChange={e => strategy(e.target.value as Options['strategy'])}>
          <option value="efficient">精细压缩 · CPU</option><option value="maruko">小丸经典参考 · x264</option><option value="standard">快速分享 · 显卡优先</option>
        </select></label>
        <p className="field-hint">{o.strategy === 'efficient' ? '用更多编码时间换取压缩效率；默认保留原始分辨率。' : o.strategy === 'maruko' ? '按公开旧版小丸源码参数配置；固定 H.264、8bit、veryslow。' : '优先处理速度，也可选择 CPU 或混合批量压缩。'}</p>
        <label className="form-label">素材类型<select aria-label="素材类型" value={o.content} onChange={e => { const content = e.target.value as Options['content']; onChange({ ...o, content, ...(o.strategy === 'efficient' ? recommend(content) : {}) }) }}>
          <option value="general">日常实拍 / 手机视频</option><option value="animation">动漫 / 二次元</option><option value="screen">录屏 / 教程文字</option>
        </select></label>
        <p className="field-hint">{o.content === 'screen' ? '精细方案优先原分辨率和低 CRF，避免小字模糊。' : o.content === 'animation' ? 'CPU 精细方案使用 animation 调优；小丸参考保留原参数。' : '保留原画面细节，不自动降帧或降噪。'}</p>
      </div>

      <div className="acceleration-setting"><label className="form-label">加速方式<select aria-label="加速方式" value={o.encoder} disabled={hardware.detecting || fixedCPU} onChange={e => onChange({ ...o, encoder: e.target.value as Encoder, bitDepth: '8' })}>
        <option value="auto">自动选择 · 优先显卡</option>{encoders.map(item => <option key={item.id} value={item.id} disabled={!available(item.id)}>{item.label}{available(item.id) ? '' : ' · 不可用'}</option>)}<option value="cpu">CPU 软件编码</option>
      </select></label><p className={`acceleration-status ${unavailable ? 'unavailable' : ''}`} role="status">{hardware.detecting ? '正在检测可用编码器…' : fixedCPU ? '当前方案使用 CPU，保证编码参数一致。' : unavailable ? '当前编码器不可用，请选择自动或 CPU。' : `当前：${actualLabel}`}</p>
        {!fixedCPU && <><label className="audio-toggle mixed-toggle"><span><strong>CPU + 显卡混合并行</strong><small>批量时同时处理两个视频</small></span><input type="checkbox" role="switch" aria-label="CPU + 显卡混合并行" checked={o.parallel} disabled={actual === 'cpu' || hardware.detecting || unavailable} onChange={e => patch('parallel', e.target.checked)} /><span className="switch-track" aria-hidden="true" /></label><p className="mixed-hint">不同编码器输出的画质和体积可能不同。</p></>}
      </div>

      <div className="setting-block rate-settings"><label className="form-label">压缩模式<select aria-label="压缩模式" value={o.rateControl} onChange={e => onChange({ ...o, rateControl: e.target.value as Options['rateControl'], ...(e.target.value === 'size' ? { encoder: 'cpu' as const, parallel: false } : {}) })}>
        <option value="quality">恒定画质 · CRF / CQ</option><option value="size">指定体积 · CPU 二遍编码</option>
      </select></label>
        {o.rateControl === 'size' ? <><label className="form-label target-size-label">每个视频的目标大小（MB）<input aria-label="目标大小 MB" type="number" min="0.1" max="102400" step="0.1" value={o.targetMB} onChange={e => patch('targetMB', Number(e.target.value))} /></label><p className="field-hint">先分析画面，再分配码率；预留音频与封装空间。目标为近似值，不是越小画质越好。</p></> : <><h3 className="preset-label">画质预设</h3><div className="presets">{presets.map((item, index) => <button key={item.name} className={`preset ${o.crf === values[index] ? 'selected' : ''}`} aria-pressed={o.crf === values[index]} onClick={() => patch('crf', values[index])}><item.icon size={19} /><span><strong>{item.name}</strong><small>{item.desc}</small></span><span className="radio-mark">{o.crf === values[index] && <span />}</span></button>)}</div><div className="quality-label"><label htmlFor="quality">画质系数</label><span>{qualityUnit} <strong>{qualityValue}</strong></span></div><input id="quality" className="quality-range" aria-label={`画质系数 ${qualityUnit}`} type="range" min="18" max="35" step={actual === 'cpu' || actual === 'nvenc' ? 0.5 : 1} value={qualityValue} onChange={e => patch('crf', Number(e.target.value))} style={{ '--range-fill': `${(o.crf - 18) / 17 * 100}%` } as CSSProperties} /><div className="range-labels"><span>更清晰</span><span>更小巧</span></div></>}
      </div>

      <div className="setting-block"><h3>视频参数</h3><div className="form-grid"><label>输出格式<select aria-label="输出格式" value={o.format} onChange={e => patch('format', e.target.value as Options['format'])}><option value="mp4">MP4</option><option value="mkv">MKV</option></select></label><label>视频编码<select aria-label="视频编码" disabled={o.strategy === 'maruko'} value={o.codec} onChange={e => onChange({ ...o, codec: e.target.value as Options['codec'], bitDepth: '8' })}><option value="h264">H.264</option><option value="h265">H.265</option></select></label></div>
        <label className="form-label spaced-field">色深<select aria-label="色深" value={o.bitDepth} disabled={o.codec !== 'h265' || o.encoder !== 'cpu' || o.strategy === 'maruko'} onChange={e => patch('bitDepth', e.target.value as Options['bitDepth'])}><option value="8">8bit · 兼容优先</option><option value="10">10bit · H.265 精细编码</option></select></label>
        <label className="form-label spaced-field">分辨率<select aria-label="分辨率" value={o.resolution} onChange={e => patch('resolution', e.target.value as Options['resolution'])}><option value="original">保持原始分辨率</option><option value="1080">最高 1080p</option><option value="720">最高 720p</option><option value="480">最高 480p</option></select></label>
        <label className="form-label spaced-field">编码速度<select aria-label="编码速度" value={o.speed} disabled={o.strategy === 'maruko'} onChange={e => patch('speed', e.target.value as Options['speed'])}><option value="fast">fast · 快速</option><option value="medium">medium · 均衡</option><option value="slow">slow · 精细</option><option value="slower">slower · 更精细</option><option value="veryslow">veryslow · 耗时更多</option></select></label>
      </div>

      <div className="setting-block extra-settings"><label className="form-label">音频处理<select aria-label="音频处理" value={o.audio} onChange={e => patch('audio', e.target.value as Options['audio'])}><option value="keep">AAC · 兼容输出</option><option value="copy">复制原音轨 · 避免二次压缩</option><option value="mute">移除音频</option></select></label>{o.audio === 'keep' && <label className="form-label spaced-field">音频码率<select aria-label="音频码率" value={o.audioKbps} onChange={e => patch('audioKbps', Number(e.target.value))}>{[64, 96, 128, 160, 192, 256, 320].map(value => <option key={value} value={value}>{value} kbps</option>)}</select></label>}<p className="field-hint">复制音轨需与输出容器兼容；10bit 编码不会恢复源文件已丢失的细节。</p></div>
    </fieldset>
    <div className="settings-tip"><Info size={16} /><p>压缩看画质与体积的取舍。不同编码器的系数不可直接比较；二遍编码不保证比恒定画质更清晰。</p></div>
  </aside>
}
