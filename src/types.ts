export type Encoder = 'auto' | 'cpu' | 'nvenc' | 'qsv' | 'amf'
export type Options = { codec: 'h264' | 'h265'; format: 'mp4' | 'mkv'; resolution: 'original' | '1080' | '720' | '480'; crf: number; speed: 'fast' | 'medium' | 'slow'; audio: 'keep' | 'mute'; encoder: Encoder }
export type Job = { id: string; path: string; name: string; size: number; duration: number; width: number; height: number; fps: number; codec: string; thumbnail: string; status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'; progress: number; output?: string; outputSize?: number; completedAt?: string; error?: string; startedAt?: number; options?: Options; encoder?: Encoder; encoderLabel?: string; notice?: string }
export type Hardware = { detecting: boolean; encoders: { id: Encoder; label: string; codecs: Options['codec'][] }[] }
export type AppState = { jobs: Job[]; history: Job[]; busy: boolean; importing: boolean; outputDirectory: string; lastError: string; engineReady: boolean; hardware: Hardware }
export interface FrameAPI {
  getState(): Promise<AppState>; pickFiles(): Promise<AppState>; addDroppedFiles(files: File[]): Promise<AppState>;
  pickDirectory(): Promise<AppState>; start(options: Options): Promise<AppState>; cancel(): Promise<AppState>;
  remove(id: string): Promise<AppState>; clear(): Promise<AppState>; retry(id: string): Promise<AppState>;
  reveal(id: string): Promise<void>; openDirectory(): Promise<void>; clearHistory(): Promise<AppState>;
  onState(callback: (state: AppState) => void): () => void;
}
declare global { interface Window { frame?: FrameAPI } }
