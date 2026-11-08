import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, ArrowRight, CheckCircle2, ChevronRight, CircleHelp, Clapperboard, FileVideo2, Folder, FolderOpen, History, Info, Layers3, LoaderCircle, LockKeyhole, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, Square, Trash2, Upload, X, XCircle, Zap } from 'lucide-react'
import type { AppState, Job, Options, Encoder } from './types'
import { TranscodeAdvice } from './TranscodeAdvice'
import { CompressionSettings, defaultOptions } from './CompressionSettings'
import './styles.css'
import './jade-theme.css'
import './workspace.css'
import { ModePicker } from './ModePicker'
import { loadOptions, modeOf } from './modes'

const initial: AppState = { jobs: [], history: [], busy: false, importing: false, outputDirectory: '', lastError: '', engineReady: false, hardware: { detecting: true, encoders: [] } }

function bytes(value: number) { if (!value) return '0 B'; const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index > 1 ? 2 : index === 1 ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][index]}` }
function duration(value: number) { const s = Math.round(value); return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}` }
function saved(job: Job) { const change = (1 - (job.outputSize || 0) / job.size) * 100; return change >= 0 ? `减少 ${change.toFixed(1)}%` : `增大 ${Math.abs(change).toFixed(1)}%` }

function App() {
  const [state, setState] = useState<AppState>(initial)
  const [options, setOptions] = useState<Options>(() => loadOptions(localStorage.getItem('baiyujing-ningying-options')))
  const [view, setView] = useState<'queue' | 'history'>('queue')
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const helpRef = useRef<HTMLDialogElement>(null)
  const dragCount = useRef(0)
  const api = window.frame
  useEffect(() => {
    if (!api) return
    const off = api.onState(setState)
    api.getState().then(setState).catch(e => setError(e.message))
    return off
  }, [api])
  useEffect(() => { localStorage.setItem('baiyujing-ningying-options', JSON.stringify(options)) }, [options])
  useEffect(() => { const handle = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'o') { event.preventDefault(); if (!state.busy && !state.importing) void act(() => api!.pickFiles()) } }; document.addEventListener('keydown', handle); return () => document.removeEventListener('keydown', handle) }, [state.busy, state.importing])
  async function act(action: () => Promise<AppState | void>) {
    if (!api) { setError('请打开凝影阁桌面版使用本地视频压缩。浏览器中仅展示界面。'); return }
    try { setError(''); const result = await action(); if (result) setState(result) } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作失败，请重试。') }
  }
  const hardwareOptions: { id: Encoder; label: string }[] = [{ id: 'nvenc', label: 'NVIDIA NVENC' }, { id: 'qsv', label: 'Intel Quick Sync' }, { id: 'amf', label: 'AMD AMF' }]
  const available = (id: Encoder) => state.hardware.encoders.some(item => item.id === id && (options.strategy === 'smart' ? item.codecs.length > 0 : item.codecs.includes(options.codec)))
  const effectiveEncoder = options.encoder === 'auto' ? hardwareOptions.find(item => available(item.id))?.id || 'cpu' : options.encoder
  const effectiveLabel = hardwareOptions.find(item => item.id === effectiveEncoder)?.label || 'CPU 软件编码'
  const encoderUnavailable = options.encoder !== 'auto' && options.encoder !== 'cpu' && !available(options.encoder)
  const qualityUnit = { auto: 'CRF', cpu: 'CRF', nvenc: 'CQ', qsv: 'ICQ', amf: 'QP' }[effectiveEncoder]
  const locked = state.busy || state.importing
  const pending = state.jobs.filter(job => job.status === 'queued')
  const completed = state.jobs.filter(job => job.status === 'completed')
  const skipped = state.jobs.filter(job => job.status === 'skipped')
  const originalSize = state.jobs.reduce((sum, job) => sum + job.size, 0)
  const completedSource = completed.reduce((sum, job) => sum + job.size, 0)
  const completedOutput = completed.reduce((sum, job) => sum + (job.outputSize || 0), 0)
  const activeJobs = state.jobs.filter(job => job.status === 'processing')
  const active = activeJobs[0]
  const currentJobs = view === 'queue' ? state.jobs : state.history
  const shownJobs = currentJobs.filter(job => job.name.toLowerCase().includes(query.toLowerCase()))
  const selectedJob = currentJobs.find(job => job.id === selected)
  const visibleError = error || (state.lastError !== dismissed ? state.lastError : '')
  function patch<K extends keyof Options>(key: K, value: Options[K]) { setOptions(old => ({ ...old, [key]: value })) }

  return <div className="app-shell" onDragOver={event => { event.preventDefault() }} onDrop={event => {
    event.preventDefault(); dragCount.current = 0; setDragging(false)
    if (!locked && event.dataTransfer.files.length) { setView('queue'); void act(() => api!.addDroppedFiles(Array.from(event.dataTransfer.files))) }
  }} onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { dragCount.current++; if (!locked) setDragging(true) } }} onDragLeave={() => { dragCount.current--; if (dragCount.current <= 0) { dragCount.current = 0; setDragging(false) } }}>
    <aside className="sidebar">
      <div className="wordmark">白玉京</div>
      <div className="sidebar-caption">凝影阁 · 影像轻藏</div>
      <nav aria-label="主导航">
        <button className={`nav-item ${view === 'queue' ? 'active' : ''}`} aria-current={view === 'queue' ? 'page' : undefined} onClick={() => { setView('queue'); setQuery(''); setSelected(null) }}><Layers3 size={19} /><span>视频压缩</span>{state.jobs.length > 0 && <span className="nav-count">{state.jobs.length}</span>}</button>
        <button className={`nav-item ${view === 'history' ? 'active' : ''}`} aria-current={view === 'history' ? 'page' : undefined} onClick={() => { setView('history'); setQuery(''); setSelected(null) }}><History size={19} /><span>处理记录</span></button>
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-note"><div className="privacy-icon"><ShieldCheck size={21} /></div><strong>文件留在你身边</strong><p>压缩在本机完成，<br />视频无需上传。</p></div>
        <button className="guide-button" onClick={() => helpRef.current?.showModal()}><CircleHelp size={18} /><span>使用指南</span><ChevronRight size={15} /></button>
        <div className="version">白玉京系列 <span>v0.8.0</span></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">工作空间 <ChevronRight size={14} /><strong>{view === 'queue' ? '视频压缩' : '处理记录'}</strong></div><div className="local-badge"><LockKeyhole size={13} /> 本地离线处理</div></header>
      <div className={`workspace ${view === 'history' ? 'history-layout' : ''}`}>
        <main className="main-content">
          <div className="page-heading"><div><h1>{view === 'queue' ? '凝影阁' : '处理记录'}</h1><p>{view === 'queue' ? '凝万千光影，藏于方寸之间。' : '查看压缩与分析记录，快速找到成品或原片。'}</p></div><button className="button primary add-button" disabled={locked} onClick={() => { setView('queue'); void act(() => api!.pickFiles()) }}><Plus size={17} /> 添加视频</button></div>

          {visibleError && <div className="error-banner" role="alert"><XCircle size={18} /><span>{visibleError}</span><button className="icon-button" aria-label="关闭错误提示" onClick={() => { setError(''); setDismissed(state.lastError) }}><X size={16} /></button></div>}
          {!api && <div className="browser-note"><Info size={16} />界面预览模式 · 运行桌面版即可在本地压缩视频</div>}

          {view === 'queue' && <ModePicker options={options} onChange={setOptions} locked={locked} />}
          {view === 'queue' && <button className={`dropzone ${state.jobs.length ? 'compact' : ''} ${dragging ? 'dragging' : ''}`} disabled={locked} onClick={() => void act(() => api!.pickFiles())}>
            <div className="upload-symbol">{state.importing ? <LoaderCircle size={27} className="spin" /> : <Upload size={27} strokeWidth={1.7} />}</div>
            <div className="dropzone-copy"><strong>{state.importing ? '正在读取视频信息…' : dragging ? '松开鼠标，添加视频' : '把视频拖到这里'}</strong><span>{state.jobs.length ? '或点击继续添加视频' : <>或<span className="inline-link">选择视频文件</span>，支持批量添加</>}</span></div>
            {!state.jobs.length && <span className="format-hint">MP4、MOV、MKV、AVI、WebM 等常见格式</span>}
            {!state.jobs.length && <span className="keyboard-hint"><kbd>Ctrl</kbd> + <kbd>O</kbd> 快速添加</span>}
          </button>}

          {view === 'queue' && <TranscodeAdvice jobs={state.jobs} options={options} onChange={setOptions} locked={locked} />}

          <section className="queue-panel" aria-label={view === 'queue' ? '视频队列' : '历史记录'}>
            <div className="queue-toolbar"><div className="queue-title"><h2>{view === 'queue' ? '文件队列' : '处理结果'}</h2><span className="count-badge">{currentJobs.length}</span></div><div className="queue-actions">{currentJobs.length > 0 && <label className="search-field"><Search size={15} /><input aria-label="搜索视频" placeholder="搜索文件" value={query} onChange={event => setQuery(event.target.value)} /></label>}<button className="text-button muted" disabled={locked || currentJobs.length === 0} onClick={() => void act(() => view === 'queue' ? api!.clear() : api!.clearHistory())}><Trash2 size={14} />{view === 'queue' ? '清空' : '清空记录'}</button></div></div>
            {currentJobs.length === 0 ? <div className="empty-state"><FileVideo2 size={34} strokeWidth={1.2} /><strong>{view === 'queue' ? '你的下一个视频，从这里开始' : '还没有处理记录'}</strong><p>{view === 'queue' ? '添加视频后，可查看文件信息和压缩进度' : '压缩与保留原片的记录会保存在这里，最多 100 条'}</p></div> : shownJobs.length === 0 ? <div className="empty-state"><Search size={28} /><strong>没有找到匹配的视频</strong><p>试试其他文件名</p></div> : <div className="file-list">{shownJobs.map(job => <FileRow key={job.id} job={job} historyView={view === 'history'} locked={locked} selected={selected === job.id} onSelect={() => setSelected(selected === job.id ? null : job.id)} onRemove={() => { if (selected === job.id) setSelected(null); void act(() => view === 'history' ? api!.removeHistory(job.id) : api!.remove(job.id)) }} onRetry={() => { setView('queue'); void act(() => api!.retry(job.id)) }} onReveal={() => void act(() => api!.reveal(job.id))} />)}</div>}
            {currentJobs.length > 0 && <div className="queue-footnote"><ShieldCheck size={14} /><span>输出为新文件，原视频始终保留</span><span className="queue-total">{currentJobs.length} 个文件 · {bytes(currentJobs.reduce((sum, job) => sum + job.size, 0))}</span></div>}
          </section>

          {selectedJob && <section className="file-details"><div><FileVideo2 size={16} /><strong>视频信息</strong><button className="icon-button" aria-label="关闭视频信息" onClick={() => setSelected(null)}><X size={15} /></button></div><dl><div><dt>分辨率</dt><dd>{selectedJob.width} × {selectedJob.height}</dd></div><div><dt>帧率</dt><dd>{selectedJob.fps.toFixed(2)} fps</dd></div><div><dt>视频编码</dt><dd>{selectedJob.codec.toUpperCase()}</dd></div><div><dt>时长</dt><dd>{duration(selectedJob.duration)}</dd></div><div><dt>源视频码率</dt><dd>{selectedJob.videoBitrate ? `${(selectedJob.videoBitrate / 1e6).toFixed(2)} Mbps` : '未知'}</dd></div><div><dt>输出编码</dt><dd>{selectedJob.outputCodec?.toUpperCase() || (selectedJob.output ? selectedJob.options?.codec.toUpperCase() : '') || '—'}</dd></div><div><dt>输出视频码率</dt><dd>{selectedJob.outputVideoBitrate ? `${(selectedJob.outputVideoBitrate / 1e6).toFixed(2)} Mbps` : '—'}</dd></div><div><dt>源编码标签</dt><dd>{selectedJob.codecTag || '—'}</dd></div></dl><p title={selectedJob.path}>{selectedJob.path}</p>{selectedJob.output && <p title={selectedJob.output}>输出：{selectedJob.output}</p>}</section>}

          {view === 'queue' && <div className="workflow-note"><div className="note-icon"><Zap size={18} /></div><div><strong>模式决定用途，右侧确认搭配</strong><p>不想研究参数选自动压缩；自己控制清晰度选手动调画质；播放不了选兼容播放。</p></div><button className="icon-button" aria-label="查看压缩指南" onClick={() => helpRef.current?.showModal()}><ArrowRight size={18} /></button></div>}
          {view === 'history' && <p className="history-note">每条记录右侧的垃圾桶可单独删除。删除或清空记录都不会删除原视频和压缩后的文件。</p>}
          <div className="workspace-bottom-note"><LockKeyhole size={13} /> 一帧一影，尽藏方寸。</div>
        </main>

        {view === 'queue' && <CompressionSettings options={options} onChange={setOptions} locked={locked} hardware={state.hardware} />}
      </div>

      <footer className="bottom-bar"><div className="output-location"><div className="output-icon"><Folder size={19} /></div><div><span>输出位置</span><button className="directory-path" disabled={state.busy} title={state.outputDirectory || '默认保存在系统视频目录的白玉京 / 凝影阁文件夹'} onClick={() => void act(() => api!.pickDirectory())}>{state.outputDirectory || '白玉京 / 凝影阁'}<ChevronRight size={13} /></button></div><button className="icon-button" aria-label="打开输出文件夹" title="打开输出文件夹" onClick={() => void act(() => api!.openDirectory())}><FolderOpen size={17} /></button></div><div className="footer-action"><div className="batch-summary">{state.busy ? <><strong>{activeJobs.length > 1 ? `同时压缩 ${activeJobs.length} 个视频` : `正在压缩 ${state.jobs.findIndex(job => job.id === active?.id) + 1} / ${state.jobs.length}`}</strong><span>{activeJobs.length > 1 ? `${activeJobs.some(job => job.encoder !== 'cpu') ? '显卡 + CPU' : 'CPU 并行'} · 已完成 ${completed.length} / ${state.jobs.length}` : `${active?.encoderLabel || effectiveLabel} · ${Math.round(active?.progress || 0)}%`}</span></> : completed.length > 0 ? <><strong>已完成 {completed.length} 个视频{skipped.length > 0 ? `，保留 ${skipped.length} 个原片` : ''}</strong><span>{completedSource >= completedOutput ? `已节省 ${bytes(completedSource - completedOutput)}` : `增大 ${bytes(completedOutput - completedSource)}`}</span></> : skipped.length > 0 ? <><strong>已保留 {skipped.length} 个原片</strong><span>未生成不符合目标的新文件</span></> : <><strong>{pending.length ? `${pending.length} 个视频待处理` : '准备好，随时开始'}</strong><span>{originalSize ? `原始大小 ${bytes(originalSize)}` : '添加视频，选择适合的画质'}</span></>}</div>{state.busy ? <button className="button cancel-button" onClick={() => void act(() => api!.cancel())}><Square size={14} /> 取消压缩</button> : <button className="button primary start-button" disabled={!pending.length || state.importing || !state.engineReady || state.hardware.detecting || encoderUnavailable || (modeOf(options) === 'size' && (!Number.isFinite(options.targetMB) || options.targetMB < 0.1 || options.targetMB > 102400))} onClick={() => { setView('queue'); void act(() => api!.start(options)) }}><Zap size={17} /> {modeOf(options) === 'smart' ? '分析并压缩' : modeOf(options) === 'compatible' ? '开始转码' : '开始压缩'} {pending.length > 0 && <span>{pending.length}</span>}</button>}</div></footer>
    </div>
    {dragging && <div className="drag-overlay"><Upload size={42} /><strong>松开鼠标，添加视频</strong><span>视频只在本地处理</span></div>}
    <dialog ref={helpRef} className="help-dialog"><div className="dialog-heading"><h2>轻松压缩，三步就好</h2><button className="icon-button" aria-label="关闭使用指南" onClick={() => helpRef.current?.close()}><X size={19} /></button></div><ol><li><strong>添加视频</strong><p>拖放文件，或点击「添加视频」。支持批量处理；Ctrl + O 可快速打开选择窗口。</p></li><li><strong>选择用途</strong><p>自动压缩自动试压；手动调画质自己决定清晰度并选择 CPU 或显卡；指定大小按每个文件的目标进行两遍编码；快速压缩优先显卡；兼容播放固定 MP4、H.264、AAC。切换模式会恢复该模式推荐搭配，请在右侧确认。小丸经典参考在手动调画质与指定大小的更多设置中。</p></li><li><strong>开始压缩</strong><p>自动压缩可选 CPU 或显卡，先试压比较画面再完整编码。快速 / 兼容转码的自动模式优先显卡，失败时改用 CPU。批量视频可开启混合并行，同时由显卡和 CPU 各处理一个文件。显卡负责视频编码，解码、缩放与音频仍占用 CPU。选择输出目录后开始，完成后点击文件夹图标查看视频。取消后可单独重试。输出同名时自动编号，保留原始文件。</p></li></ol><div className="help-note"><Info size={18} /><span>智能模式预计缩小至少 10% 才完整编码，实际缩小不足 5% 不导出；抽样评分不保证整片视觉无损。HDR、多音轨、字幕等特殊素材会跳过。手动模式仅保留第一路视频与音频，可能产生更大文件；指定体积为近似值。</span></div><button className="button primary" onClick={() => helpRef.current?.close()}>开始使用</button></dialog>
  </div>
}

function FileRow({ job, historyView, locked, selected, onSelect, onRemove, onRetry, onReveal }: { job: Job; historyView: boolean; locked: boolean; selected: boolean; onSelect: () => void; onRemove: () => void; onRetry: () => void; onReveal: () => void }) {
  const noReduction = job.status === 'completed' && (job.outputSize ?? 0) >= job.size
  const status = { queued: '等待压缩', processing: `${job.phaseLabel || '正在压缩'} ${Math.round(job.progress)}%`, completed: noReduction ? '转码完成' : '已完成', failed: '压缩失败', cancelled: '已取消', skipped: '已保留原片' }[job.status]
  return <article className={`file-row ${selected ? 'is-selected' : ''}`}>
    <button className="file-select" aria-label={`查看 ${job.name} 的信息`} onClick={onSelect}><div className="thumbnail">{job.thumbnail ? <img src={job.thumbnail} alt="" /> : <FileVideo2 size={23} />}<span>{duration(job.duration)}</span></div><div className="file-info"><strong title={job.name}>{job.name}</strong><div className="file-metadata"><span>{job.width} × {job.height}</span><span>{job.codec.toUpperCase()}</span><span>{bytes(job.size)}</span></div><div className={`file-status ${job.status} ${noReduction ? 'no-reduction' : ''}`}>{job.status === 'completed' ? noReduction ? <Info size={13} /> : <CheckCircle2 size={13} /> : job.status === 'processing' ? <LoaderCircle size={13} className="spin" /> : job.status === 'skipped' ? <ShieldCheck size={13} /> : job.status === 'failed' ? <XCircle size={13} /> : job.status === 'cancelled' ? <Square size={11} /> : <span className="status-dot" />}<span>{status}</span>{job.encoderLabel && <span className="encoder-label">{job.encoderLabel}</span>}{job.status === 'completed' && <><span className="status-divider">/</span><span>{bytes(job.outputSize || 0)} · {saved(job)}</span>{(job.outputCodec || job.options?.codec) && <span className="output-codec">输出 {(job.outputCodec || job.options?.codec)?.toUpperCase()}{job.outputVideoBitrate ? ` · ${(job.outputVideoBitrate / 1e6).toFixed(2)} Mbps` : ''}</span>}</>}</div></div></button>
    <div className="file-actions">{(job.status === 'completed' || job.status === 'skipped') ? <button className="icon-button" title={job.status === 'skipped' ? '查看原片' : '在文件夹中显示'} aria-label={`查看 ${job.name} 的${job.status === 'skipped' ? '原片' : '输出文件'}`} onClick={onReveal}><FolderOpen size={18} /></button> : ['failed', 'cancelled'].includes(job.status) && <button className="icon-button" disabled={locked} title="重新加入队列" aria-label={`重试 ${job.name}`} onClick={onRetry}><RotateCcw size={17} /></button>}{job.status === 'skipped' && <button className="icon-button" disabled={locked} aria-label={`重新分析 ${job.name}`} title="重新加入队列" onClick={onRetry}><RotateCcw size={17} /></button>}{historyView ? <button className="icon-button remove-history" disabled={locked} title="只删除记录，不删除视频文件" aria-label={`删除 ${job.name} 的处理记录`} onClick={onRemove}><Trash2 size={17} /></button> : job.status !== 'completed' && <button className="icon-button remove-file" disabled={locked} aria-label={`移除 ${job.name}`} onClick={onRemove}><X size={16} /></button>}</div>
    {job.status === 'processing' && <div className="file-progress" role="progressbar" aria-label={`${job.name} 压缩进度`} aria-valuenow={Math.round(job.progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${job.progress}%` }} /></div>}
    {job.smartAnalysis && <div className="smart-result">{job.status === 'skipped' ? <><strong>原片已保留</strong><p>{job.skipReason || job.smartAnalysis.reason}</p></> : job.smartAnalysis.decision === 'encode' && job.smartAnalysis.options ? <><strong>已找到合适画质 · {job.encoderLabel || job.smartAnalysis.encoderLabel}</strong><p>预计缩小 {((job.smartAnalysis.estimatedSaving || 0) * 100).toFixed(1)}%，实际结果以完成后的文件为准。</p></> : <p>{job.status === 'cancelled' ? '智能分析已取消，可重新加入队列。' : job.status === 'failed' ? '智能任务未完成。' : job.smartAnalysis.phase}</p>}</div>}{job.compressionWarning && <p className="job-notice size-warning">{job.compressionWarning}</p>}{noReduction && !job.compressionWarning && <p className="job-notice size-warning">本次输出未减小。兼容转码可能变大；要限制大小，请使用指定体积模式。</p>}{job.notice && <p className="job-notice">{job.notice}</p>}{job.error && <p className="job-error">{job.error}</p>}
  </article>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
