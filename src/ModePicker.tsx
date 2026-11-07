import { Sparkles, Gem, HardDrive, Zap, MonitorPlay, Check } from 'lucide-react'
import type { Options } from './types'
import { modes, modeOf, selectMode } from './modes'
const icons = { smart: Sparkles, quality: Gem, size: HardDrive, fast: Zap, compatible: MonitorPlay }
export function ModePicker({ options, onChange, locked }: { options: Options; onChange: (o: Options) => void; locked: boolean }) {
  const selected = modeOf(options); const mode = modes.find(m => m.id === selected)!
  return <section className="mode-picker" aria-label="处理用途">
    <div className="section-heading"><h2>这次想怎样处理？</h2><span>选择用途，自动搭配参数</span></div>
    <div className="mode-grid" role="group" aria-label="选择处理模式">{modes.map(item => { const Icon = icons[item.id]; return <button key={item.id} className={`mode-choice ${selected === item.id ? 'selected' : ''}`} aria-pressed={selected === item.id} aria-label={item.name} disabled={locked} onClick={() => onChange(selectMode(options, item.id))}><Icon size={21} aria-hidden="true" /><strong>{item.name}</strong><span>{item.short}</span>{selected === item.id && <Check className="mode-check" size={14} aria-hidden="true" />}</button> })}</div>
    <div className="mode-explanation" role="status"><p>{mode.description}</p><span>{mode.tradeoff}</span></div>
  </section>
}
