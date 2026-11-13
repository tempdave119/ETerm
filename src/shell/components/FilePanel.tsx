import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, FileText, Folder, RefreshCw, X } from 'lucide-react';
import type { FileEntry, FilePreview } from '../../shared/ipc.ts';

interface FilePanelProps {
  sessionId: string;
  onClose(): void;
}

export function FilePanel({ sessionId, onClose }: FilePanelProps) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(
    async (target: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const result = await window.eterm.listFiles(sessionId, target);
        if (!result.ok) {
          setError(result.error.message);
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
        setPreviewError(result.error.message);
        return;
      }
      setPreview(result.value);
    },
    [load, sessionId],
  );

  return (
    <aside className="file-panel" data-testid="file-panel">
      <header className="file-panel__header">
        <span className="file-panel__title">文件</span>
        <button
          className="icon-button"
          type="button"
          title="上一级"
          aria-label="上一级"
          disabled={path === '/'}
          onClick={() => void load(parentOf(path))}
        >
          <ArrowUp size={16} strokeWidth={1.5} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="刷新"
          aria-label="刷新"
          onClick={() => void load(path)}
        >
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
        <button className="icon-button" type="button" title="关闭文件面板" aria-label="关闭文件面板" onClick={onClose}>
          <X size={14} strokeWidth={1.5} />
        </button>
      </header>

      <div className="file-panel__path" title={path}>
        {path}
      </div>

      <div className="file-panel__list">
        {loading ? (
          <div className="file-panel__hint">正在读取…</div>
        ) : error ? (
          <div className="file-panel__hint file-panel__hint--error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="file-panel__hint">此目录为空</div>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.path}
              className="file-row"
              type="button"
              title={entry.path}
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
          ))
        )}
      </div>

      {preview || previewError ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--wide" role="dialog" aria-modal="true" data-testid="file-preview">
            <h2 className="modal__title">{preview ? baseName(preview.path) : '无法预览'}</h2>
            {previewError ? <p className="form-error">{previewError}</p> : null}
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
    </aside>
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
