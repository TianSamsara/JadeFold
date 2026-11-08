import { Cpu, Monitor } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Options, Encoder, Hardware } from './types'
import { modeOf, actualEncoder, selectDevice } from './modes'

export const qualityNames = { detail: '尽量保留细节', balanced: '清晰且适中', smaller: '文件更小' }
export function qualityValues(o: Options) { return o.content === 'screen' ? [18, 21, 24] : [20, 24, 28] }
export function QualityControls({ options: o, onChange }: { options: Options; onChange: (o: Options) => void }) {
  const smart = o.strategy === 'smart'; const values = qualityValues(o)
  return <section className="setting-block friendly-quality" aria-label="画质与细节"><h3>画质与细节</h3>
    <div className="quality-segments">{(['detail', 'balanced', 'smaller'] as const).map((key, i) => <button key={key} aria-pressed={smart ? o.qualityPreference === key : o.crf === values[i]} onClick={() => onChange({ ...o, qualityPreference: key, ...(smart ? {} : { crf: values[i] }) })}>{qualityNames[key]}</button>)}</div>
    {smart ? <p className="field-hint">{o.qualityPreference === 'detail' ? '对细节要求更高。文件可能更大，也更容易判定为不值得再压。' : o.qualityPreference === 'smaller' ? '允许损失更多细节，尝试换取更小文件；小字、纹理可能不如原片清楚。' : '在细节和大小之间取折中，是默认选择。'} 程序会按这个要求试压，原片始终保留。</p> : <>
      <label className="quality-label" htmlFor="quality">再微调一点 <span>{o.crf <= values[0] ? '偏重细节' : o.crf >= values[2] ? '偏重体积' : '适中'}</span></label>
      <input id="quality" type="range" className="quality-range" style={{ '--range-fill': `${(35 - o.crf) / 17 * 100}%` } as CSSProperties} aria-label="画面细节" aria-valuetext={o.crf <= values[0] ? '更多细节，文件通常更大' : o.crf >= values[2] ? '更小文件，细节有所减少' : '细节与大小适中'} min="0" max="34" step="1" value={(35 - o.crf) * 2} onChange={e => onChange({ ...o, crf: 35 - Number(e.target.value) / 2 })} />
      <div className="range-labels"><span>文件更小</span><span>细节更多</span></div><p className="field-hint">往右通常更清晰、文件也更大。这是保留原有细节，不会修复原片已经模糊的部分。</p>
    </>}
  </section>
}

export const deviceNames: Record<string, string> = { cpu: 'CPU', nvenc: 'NVIDIA 显卡', qsv: 'Intel 显卡', amf: 'AMD 显卡', auto: '自动选显卡' }
export function DeviceControls({ options: o, onChange, hardware }: { options: Options; onChange: (o: Options) => void; hardware: Hardware }) {
  const mode = modeOf(o); const restricted = mode === 'size' || o.strategy === 'maruko'; const smart = mode === 'smart'
  const supports = (id: string) => hardware.encoders.some(e => e.id === id && (smart ? e.codecs.length > 0 : e.codecs.includes(o.codec)))
  const hasGPU = hardware.encoders.some(e => smart ? e.codecs.length > 0 : e.codecs.includes(o.codec)); const actual = actualEncoder(o, hardware)
  return <section className="setting-block" aria-label="处理设备"><h3>用什么处理</h3>
    <div className="device-choices"><button aria-label="使用 CPU" aria-pressed={o.encoder === 'cpu'} onClick={() => onChange(selectDevice(o, 'cpu'))}><Cpu size={18} aria-hidden="true" /><strong>CPU</strong><span>多花时间，争取更小</span></button><button aria-label="使用显卡" aria-pressed={o.encoder !== 'cpu'} disabled={restricted || hardware.detecting || !hasGPU} onClick={() => onChange(selectDevice(o, 'auto'))}><Monitor size={18} aria-hidden="true" /><strong>显卡</strong><span>优先速度，画质可调</span></button></div>
    <p className="field-hint">{restricted ? mode === 'size' ? '控制大小需要先分析再压缩，当前只支持 CPU。想用显卡可选自动压缩或手动调画质。' : '小丸经典这套参数只支持 CPU；改选普通方案即可使用显卡。' : hardware.detecting ? '正在检查可用显卡…' : !hasGPU ? '没有检测到可用显卡，建议选择 CPU 处理。' : o.encoder === 'cpu' ? 'CPU 通常更有利于压小体积，但需要更多时间。' : smart ? '用显卡试压和压缩，画质检查仍会用 CPU。自动选显卡不合适时，会重新用 CPU 试压。' : '显卡通常更快；相同清晰度下，文件可能比 CPU 编码更大。'}</p>
    {!restricted && o.encoder !== 'cpu' && <><label className="form-label device-select">选择显卡<select aria-label="加速方式" value={o.encoder} onChange={e => onChange(selectDevice(o, e.target.value as Encoder))}><option value="auto">自动选择可用显卡 · 推荐</option>{['nvenc','qsv','amf'].map(id => <option key={id} value={id} disabled={!supports(id)}>{deviceNames[id]}{supports(id) ? '' : '（不可用）'}</option>)}</select></label><p className="field-hint">{smart ? '最终使用的设备会显示在每个视频的处理结果中。' : `当前：${deviceNames[actual]}。自动选择在显卡处理失败时改用 CPU。`}</p></>}
    {!restricted && !smart && o.encoder !== 'cpu' && <><label className="audio-toggle mixed-toggle"><span><strong>同时处理两个视频</strong><small>一个交给显卡，一个交给 CPU</small></span><input type="checkbox" role="switch" aria-label="CPU + 显卡混合并行" checked={o.parallel} disabled={actual === 'cpu' || hardware.detecting} onChange={e => onChange({ ...o, parallel: e.target.checked })} /><span className="switch-track" aria-hidden="true" /></label><p className="field-hint">至少添加两个视频才生效；不是把单个视频拆开压缩。</p></>}
  </section>
}
