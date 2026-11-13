/**
 * 资源端口。能力层只实现这些接口，界面只依赖这些接口；
 * 端口里不出现任何协议字段，协议只在会话配置里出现。
 */

export type Capability = 'session' | 'exec' | 'file' | 'transfer' | 'forward';

export interface SessionOpenOptions {
  protocol: string;
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
  /** 协议私有连接参数，只由对应的能力模块解释；边界层不读里面的字段。 */
  target?: unknown;
}

export interface ExitInfo {
  code: number | null;
  signal?: number;
  /** 能力模块能区分「用户退出 shell」与「链路断开」；渲染层据此决定是否自动重连。 */
  reason?: 'closed' | 'network';
}

export interface SessionPort {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData(handler: (data: string) => void): () => void;
  onExit(handler: (info: ExitInfo) => void): () => void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface ExecPort {
  exec(command: string): Promise<ExecResult>;
}

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface FileEntry {
  name: string;
  path: string;
  type: FileEntryType;
  size: number;
  mtimeMs: number;
  mode: number;
}

export interface FilePort {
  list(path: string): Promise<FileEntry[]>;
  stat(path: string): Promise<FileEntry>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
}

export interface TransferProgress {
  id: string;
  transferred: number;
  total: number;
}

/** upload / download 立即返回任务句柄，cancel(id) 才有可取消的对象。 */
export interface TransferTask {
  id: string;
  done: Promise<void>;
}

export interface TransferPort {
  upload(sourcePath: string, targetPath: string): TransferTask;
  download(sourcePath: string, targetPath: string): TransferTask;
  cancel(id: string): void;
  onProgress(handler: (progress: TransferProgress) => void): () => void;
}

export type ForwardDirection = 'local' | 'remote';

export interface ForwardRequest {
  direction: ForwardDirection;
  /** 本地转发 = 本机监听地址；远程转发 = 远端监听地址（服务器侧）。 */
  bindHost: string;
  /** 本地转发允许 0，由系统分配；远程转发要求 1–65535。 */
  bindPort: number;
  targetHost: string;
  targetPort: number;
}

export interface ForwardView extends ForwardRequest {
  id: string;
  createdAt: string;
}

export interface ForwardPort {
  open(request: ForwardRequest): Promise<ForwardView>;
  list(): ForwardView[];
  close(id: string): Promise<void>;
}
