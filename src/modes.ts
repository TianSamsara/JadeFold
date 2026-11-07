import type { Options, Hardware, Encoder } from './types'
export type Mode = 'smart' | 'quality' | 'size' | 'fast' | 'compatible'
export const modes: { id: Mode; name: string; short: string; description: string; tradeoff: string }[] = [
  { id: 'smart', name: '智能均衡', short: '不知道怎么选', description: '先试压、再决定。自动寻找画质与体积的合适搭配，缩不动就保留原片。', tradeoff: 'CPU 分析与编码 · 比直接转码耗时 · 不保证整片视觉无损' },
  { id: 'quality', name: '精细压缩', short: '愿意多等一会', description: '用 CPU 精细编码，自己决定画质取舍。适合收藏、动漫与需要保留小字的录屏。', tradeoff: 'CPU 编码 · 大小随画面复杂度变化 · 可能比原片更大' },
  { id: 'size', name: '指定大小', short: '有上传大小限制', description: '设定每个文件的目标大小，CPU 分两遍分配码率。目标越小，保留的细节越少。', tradeoff: 'CPU 两遍编码 · 目标为近似值 · 不与自动画质同时使用' },
  { id: 'fast', name: '快速压缩', short: '优先处理速度', description: '优先使用可用显卡，适合批量处理。可以让显卡与 CPU 各处理一个视频。', tradeoff: '显卡优先 · 无可用显卡时用 CPU · 不保证输出一定更小' },
  { id: 'compatible', name: '兼容播放', short: '原片播放不了', description: '固定输出 MP4、H.264 和 AAC，改善常见播放器的兼容性，适合发送给他人。', tradeoff: '显卡或 CPU · HEVC 转 H.264 可能变大 · 不保证所有设备可播放' },
]
export const defaultOptions: Options = { codec: 'h265', format: 'mp4', resolution: 'original', crf: 24, speed: 'slow', audio: 'keep', encoder: 'cpu', parallel: false, strategy: 'smart', content: 'general', rateControl: 'quality', targetMB: 50, bitDepth: '10', audioKbps: 160, smartCodec: 'preserve' }
export function modeOf(o: Options): Mode { return o.strategy === 'smart' ? 'smart' : o.strategy === 'compatible' ? 'compatible' : o.rateControl === 'size' ? 'size' : o.strategy === 'standard' ? 'fast' : 'quality' }
export function contentDefaults(content: Options['content']): Partial<Options> { return content === 'screen' ? { codec: 'h264', bitDepth: '8', crf: 18 } : { codec: 'h265', bitDepth: '10', crf: content === 'animation' ? 22 : 24 } }
export function selectMode(current: Options, mode: Mode): Options {
  const base = { ...defaultOptions, content: current.content, ...contentDefaults(current.content) }
  if (mode === 'smart') return base
  if (mode === 'quality') return { ...base, strategy: 'efficient' }
  if (mode === 'size') return { ...base, strategy: 'efficient', rateControl: 'size', codec: 'h264', bitDepth: '8', audioKbps: 128 }
  if (mode === 'compatible') return { ...base, strategy: 'compatible', codec: 'h264', bitDepth: '8', encoder: 'auto', speed: 'medium', crf: 23, content: 'general' }
  return { ...base, strategy: 'standard', codec: 'h265', bitDepth: '8', encoder: 'auto', speed: 'medium', crf: current.content === 'screen' ? 21 : 26 }
}
export function selectProfile(o: Options, strategy: 'efficient' | 'maruko'): Options {
  return strategy === 'maruko' ? { ...o, strategy, encoder: 'cpu', parallel: false, codec: 'h264', bitDepth: '8', speed: 'veryslow', crf: 23.5 }
    : { ...o, strategy, encoder: 'cpu', parallel: false, speed: 'slow', ...contentDefaults(o.content) }
}
export function actualEncoder(o: Options, h: Hardware): Encoder { return o.encoder === 'auto' ? (['nvenc', 'qsv', 'amf'] as Encoder[]).find(id => h.encoders.some(e => e.id === id && e.codecs.includes(o.codec))) || 'cpu' : o.encoder }
export function loadOptions(raw: string | null): Options {
  try {
    const saved = JSON.parse(raw || 'null'); if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultOptions
    const o = { ...defaultOptions, ...saved, ...(saved.strategy ? {} : { strategy: 'standard', bitDepth: '8' }) } as Options
    if (!['smart', 'efficient', 'maruko', 'standard', 'compatible'].includes(o.strategy)) return defaultOptions
    if (o.strategy === 'compatible') return { ...o, codec: 'h264', format: 'mp4', bitDepth: '8', audio: 'keep', rateControl: 'quality', content: 'general' }
    if (o.strategy !== 'standard' || o.rateControl === 'size') { o.encoder = 'cpu'; o.parallel = false }
    if (o.strategy === 'standard' && o.rateControl === 'size') o.strategy = 'efficient'
    if (o.strategy === 'smart') o.rateControl = 'quality'
    if (o.strategy === 'maruko') { o.codec = 'h264'; o.bitDepth = '8'; o.speed = 'veryslow' }
    if (o.codec !== 'h265' || o.encoder !== 'cpu') o.bitDepth = '8'
    return o
  } catch { return defaultOptions }
}
