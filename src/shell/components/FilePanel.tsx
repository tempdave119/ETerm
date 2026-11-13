import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Download, FileText, Folder, RefreshCw, Upload } from 'lucide-react';
import type { DockId } from '../../shared/panels.ts';
import type { FileEntry, FilePreview, ProductErrorInfo } from '../../shared/ipc.ts';
import { ErrorMessage } from './ErrorMessage.tsx';
import { PanelFrame } from './PanelFrame.tsx';

interface FilePanelProps {
  sessionId: string;
  dock: DockId | null;
  onMove(target: DockId | null): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

export function FilePanel({ sessionId, dock, onMove, canPanelMoveUp, canPanelMoveDown, onPanelReorder }: FilePanelProps) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ProductErrorInfo | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<ProductErrorInfo | null>(null);

  const load = useCallback(
    async (target: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.eterm.listFiles(sessionId, target);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setEntries([...result.value].sort(compareEntries));
        setPath(target);
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    void load('/');
  }, [load]);

  const openEntry = useCallback(
    async (entry: FileEntry): Promise<void> => {
      if (entry.type === 'directory') {
        await load(entry.path);
        return;
      }

      setPreviewError(null);
      const result = await window.eterm.readFilePreview(sessionId, entry.path);
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setPreview(result.value);
    },
    [load, sessionId],
  );

  const upload = useCallback(async (): Promise<void> => {
    setError(null);
    const result = await window.eterm.pickUpload(sessionId, path);
    if (!result.ok) setError(result.error);
  }, [path, sessionId]);

  const download = useCallback(
    async (remotePath: string): Promise<void> => {
      setError(null);
      const result = await window.eterm.pickDownload(sessionId, remotePath);
      if (!result.ok) setError(result.error);
    },
    [sessionId],
  );

  return (
    <PanelFrame
      panelId="files"
      title="文件"
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
      actions={
        <>
          <button
            className="icon-button"
            type="button"
            title="上一级"
            aria-label="上一级"
            disabled={path === '/'}
            onClick={() => void load(parentOf(path))}
          >
            <ArrowUp size={15} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="上传文件"
            aria-label="上传文件"
            data-testid="file-upload"
            onClick={() => void upload()}
          >
            <Upload size={14} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="刷新"
            aria-label="刷新"
            onClick={() => void load(path)}
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
        </>
      }
    >
      <div className="file-panel__path" title={path}>
        {path}
      </div>

      <div className="file-panel__list">
        {loading ? (
          <div className="file-panel__hint">正在读取…</div>
        ) : error ? (
          <div className="file-panel__error">
            <ErrorMessage error={error} />
          </div>
        ) : entries.length === 0 ? (
          <div className="file-panel__hint">此目录为空</div>
        ) : (
          entries.map((entry) => (
            <div className="file-row" key={entry.path} title={entry.path}>
              <button
                className="file-row__main"
                type="button"
                data-testid={`file-row-${entry.name}`}
                onClick={() => void openEntry(entry)}
              >
                {entry.type === 'directory' ? (
                  <Folder size={16} strokeWidth={1.5} className="file-row__icon" />
                ) : (
                  <FileText size={16} strokeWidth={1.5} className="file-row__icon" />
                )}
                <span className="file-row__name">{entry.name}</span>
                <span className="file-row__meta">{entry.type === 'directory' ? '' : formatSize(entry.size)}</span>
              </button>
              {entry.type !== 'directory' ? (
                <button
                  className="icon-button file-row__action"
                  type="button"
                  title={`下载 ${entry.name}`}
                  aria-label={`下载 ${entry.name}`}
                  data-testid={`file-download-${entry.name}`}
                  onClick={() => void download(entry.path)}
                >
                  <Download size={14} strokeWidth={1.5} />
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {preview || previewError ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--wide" role="dialog" aria-modal="true" data-testid="file-preview">
            <h2 className="modal__title">{preview ? baseName(preview.path) : '无法预览'}</h2>
            {previewError ? <ErrorMessage error={previewError} /> : null}
            {preview ? (
              <>
                <div className="file-preview__meta">
                  {preview.path}
                  {preview.truncated ? ' · 仅显示前 256 KB' : ''}
                </div>
                {preview.binary ? (
                  <p className="form-hint">二进制文件，暂不预览。</p>
                ) : (
                  <pre className="file-preview__content">{preview.content}</pre>
                )}
              </>
            ) : null}
            <div className="modal__actions">
              <button
                className="button button--primary"
                type="button"
                onClick={() => {
                  setPreview(null);
                  setPreviewError(null);
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PanelFrame>
  );
}

function compareEntries(left: FileEntry, right: FileEntry): number {
  if (left.type === 'directory' && right.type !== 'directory') return -1;
  if (left.type !== 'directory' && right.type === 'directory') return 1;
  return left.name.localeCompare(right.name);
}

function parentOf(value: string): string {
  if (value === '/' || !value) return '/';
  const index = value.lastIndexOf('/');
  return index <= 0 ? '/' : value.slice(0, index);
}

function baseName(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? value : value.slice(index + 1);
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
