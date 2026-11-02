import { Info } from 'lucide-react'
import type { Job, Options } from './types'

export function TranscodeAdvice({ jobs, options, onChange, locked }: { jobs: Job[]; options: Options; onChange: (value: Options) => void; locked: boolean }) {
  const pending = jobs.filter(job => job.status === 'queued')
  if (!pending.length || options.strategy === 'smart') return null
  const hevcToH264 = options.codec === 'h264' && pending.some(job => job.codec === 'hevc')
  const oversizedTarget = options.rateControl === 'size' && pending.some(job => options.targetMB * 1024 * 1024 >= job.size)
  const needsHEVC = options.codec === 'h265'
  if (!hevcToH264 && !oversizedTarget && !needsHEVC) return null
  const source = pending.find(job => job.codec === 'hevc') || pending[0]
  function limitSize() {
    onChange({ ...options, encoder: 'cpu', parallel: false, rateControl: 'size', targetMB: Math.max(0.1, Math.floor(pending[0].size * 0.85 / 1024 / 1024 * 10) / 10) })
  }
  return <section className={`transcode-advice ${hevcToH264 || oversizedTarget ? 'warning' : ''}`} role="note" aria-label="编码与体积提醒"><Info size={18} /><div>
    <strong>{hevcToH264 ? '原片已是 H.265，转为 H.264 可能变大' : oversizedTarget ? '目标体积大于或等于原片' : 'H.265 输出需要播放器支持 HEVC'}</strong>
    <p>{hevcToH264 ? `此转换适合改善播放兼容性；恒定画质不会限制大小。${source.videoBitrate ? `原视频码率约 ${(source.videoBitrate / 1e6).toFixed(2)} Mbps。` : ''}` : oversizedTarget ? '指定体积模式不会自动保证比原片更小，请检查目标大小。' : 'Windows 自带播放器可能需要 HEVC 扩展。需要广泛兼容时可使用 H.264，体积可能增加。'}</p>
    {pending.length === 1 && pending[0].size * 0.85 >= 0.1 * 1024 * 1024 && options.rateControl === 'quality' && <button className="text-button" disabled={locked} onClick={limitSize}>按原片 85% 设置目标大小</button>}
  </div></section>
}
