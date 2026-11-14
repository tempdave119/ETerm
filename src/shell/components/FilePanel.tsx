import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  Link2,
  RefreshCw,
  Upload,
} from 'lucide-react';
import type { DockId } from '../../shared/panels.ts';
import type { FileEntry, FilePreview, ProductErrorInfo } from '../../shared/ipc.ts';
import {
  formatDate,
  formatEntrySize,
  formatPermission,
  sortEntries,
  type FileSort,
  type FileSortKey,
} from '../file-sort.ts';
import { t, type MessageKey } from '../../shared/i18n/index.ts';
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

const COLUMNS: { key: FileSortKey; titleKey: MessageKey }[] = [
  { key: 'name', titleKey: 'files.name' },
  { key: 'size', titleKey: 'files.size' },
  { key: 'mtime', titleKey: 'files.date' },
  { key: 'mode', titleKey: 'files.permission' },
];

export function FilePanel({ sessionId, dock, onMove, canPanelMoveUp, canPanelMoveDown, onPanelReorder }: FilePanelProps) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ProductErrorInfo | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewError, setPreviewError] = useState<ProductErrorInfo | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sort, setSort] = useState<FileSort>({ key: 'name', direction: 'asc' });
  // 默认显示隐藏文件：运维场景常要改 .bashrc 这类点文件。
  const [showHidden, setShowHidden] = useState(true);

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
        setEntries(result.value);
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

  const visibleEntries = useMemo(() => {
    const filtered = showHidden ? entries : entries.filter((entry) => !entry.name.startsWith('.'));
    return sortEntries(filtered, sort);
  }, [entries, showHidden, sort]);

  const toggleSort = useCallback((key: FileSortKey): void => {
    setSort((current) =>
      current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' },
    );
  }, []);

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

  const dropFiles = useCallback(
    async (event: DragEvent<HTMLDivElement>): Promise<void> => {
      event.preventDefault();
      setDragOver(false);
      setError(null);
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;

      const prepared = await window.eterm.registerDroppedFiles(files);
      if (!prepared.ok) {
        setError(prepared.error);
        return;
      }
      if (prepared.value.length === 0) {
        setError({ code: 'UNSUPPORTED', message: t('files.dropEmpty.message'), next: t('files.dropEmpty.next') });
        return;
      }

      const result = await window.eterm.uploadDropped(sessionId, path, prepared.value);
      if (!result.ok) setError(result.error);
    },
    [path, sessionId],
  );

  const download = useCallback(
    async (remotePath: string): Promise<void> => {
      setError(null);
      const result = await window.eterm.pickDownload(sessionId, remotePath);
      if (!result.ok) setError(result.error);
    },
    [sessionId],
  );

  const downloadDirectory = useCallback(
    async (remotePath: string): Promise<void> => {
      setError(null);
      const result = await window.eterm.pickDownloadDir(sessionId, remotePath);
      if (!result.ok) setError(result.error);
    },
    [sessionId],
  );

  return (
    <PanelFrame
      panelId="files"
      title={t('panel.files')}
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
            title={t('files.up')}
            aria-label={t('files.up')}
            disabled={path === '/'}
            onClick={() => void load(parentOf(path))}
          >
            <ArrowUp size={15} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('files.upload')}
            aria-label={t('files.upload')}
            data-testid="file-upload"
            onClick={() => void upload()}
          >
            <Upload size={14} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('files.refresh')}
            aria-label={t('files.refresh')}
            onClick={() => void load(path)}
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={showHidden ? t('files.hideHidden') : t('files.showHidden')}
            aria-label={showHidden ? t('files.hideHidden') : t('files.showHidden')}
            aria-pressed={showHidden}
            data-testid="file-toggle-hidden"
            onClick={() => setShowHidden((current) => !current)}
          >
            {showHidden ? <Eye size={14} strokeWidth={1.5} /> : <EyeOff size={14} strokeWidth={1.5} />}
          </button>
        </>
      }
    >
      <div className="file-panel__path" title={path}>
        {path}
      </div>

      <div className="file-panel__head" role="row">
        {COLUMNS.map((column) => (
          <button
            key={column.key}
            className="file-head__cell"
            type="button"
            data-testid={`file-sort-${column.key}`}
            data-active={sort.key === column.key}
            title={t('files.sortBy', { name: t(column.titleKey) })}
            onClick={() => toggleSort(column.key)}
          >
            <span>{t(column.titleKey)}</span>
            {sort.key === column.key ? (
              sort.direction === 'asc' ? (
                <ChevronUp size={11} strokeWidth={2} />
              ) : (
                <ChevronDown size={11} strokeWidth={2} />
              )
            ) : null}
          </button>
        ))}
        <span aria-hidden="true" />
      </div>

      <div
        className="file-panel__list"
        data-dragover={dragOver ? 'true' : undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => void dropFiles(event)}
      >
        {dragOver ? <div className="file-panel__drop-hint">{t('files.dropHint', { path })}</div> : null}
        {loading ? (
          <div className="file-panel__hint">{t('common.loading')}</div>
        ) : error ? (
          <div className="file-panel__error">
            <ErrorMessage error={error} />
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="file-panel__hint">{t('files.empty')}</div>
        ) : (
          visibleEntries.map((entry) => (
            <div className="file-row" key={entry.path} title={entry.path}>
              <button
                className="file-row__main"
                type="button"
                data-testid={`file-row-${entry.name}`}
                onClick={() => void openEntry(entry)}
              >
                {entry.type === 'directory' ? (
                  <Folder size={15} strokeWidth={1.5} className="file-row__icon" />
                ) : entry.type === 'symlink' ? (
                  <Link2 size={15} strokeWidth={1.5} className="file-row__icon" />
                ) : (
                  <FileText size={15} strokeWidth={1.5} className="file-row__icon" />
                )}
                <span className="file-row__name">{entry.name}</span>
              </button>
              <span className="file-row__cell file-row__size">{formatEntrySize(entry)}</span>
              <span className="file-row__cell file-row__date">{formatDate(entry.mtimeMs)}</span>
              <span className="file-row__cell file-row__perm">{formatPermission(entry.mode)}</span>
              <button
                className="icon-button file-row__action"
                type="button"
                title={t('files.download', { name: entry.name })}
                aria-label={t('files.download', { name: entry.name })}
                data-testid={`file-download-${entry.name}`}
                onClick={() =>
                  void (entry.type === 'directory' ? downloadDirectory(entry.path) : download(entry.path))
                }
              >
                <Download size={13} strokeWidth={1.5} />
              </button>
            </div>
          ))
        )}
      </div>

      {preview || previewError ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--wide" role="dialog" aria-modal="true" data-testid="file-preview">
            <h2 className="modal__title">{preview ? baseName(preview.path) : t('files.previewTitle')}</h2>
            {previewError ? <ErrorMessage error={previewError} /> : null}
            {preview ? (
              <>
                <div className="file-preview__meta">
                  {preview.path}
                  {preview.truncated ? ` · ${t('files.previewTruncated')}` : ''}
                </div>
                {preview.binary ? (
                  <p className="form-hint">{t('files.binaryHint')}</p>
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
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </PanelFrame>
  );
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
