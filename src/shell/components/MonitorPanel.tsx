import { useEffect, useState } from 'react';
import type { DockId } from '../../shared/panels.ts';
import type { SystemStats } from '../../shared/ipc.ts';
import { PanelFrame } from './PanelFrame.tsx';

interface MonitorPanelProps {
  /** 有值且会话具备 exec 能力时采样远端；null 时采样本机。 */
  sessionId: string | null;
  /** 来源说明：远端为 user@host:port，本机为「这台 Mac」。 */
  targetLabel: string;
  /** 连接名称；本机为 null。 */
  connectionName: string | null;
  /** 进程 Top5 排序，来自配置，跨重启保留。 */
  processSort: 'memory' | 'cpu';
  onProcessSortChange(sort: 'memory' | 'cpu'): void;
  dock: DockId | null;
  onMove(target: DockId | null): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

const POLL_INTERVAL = 1000;
const REMOTE_POLL_INTERVAL = 2000;

/** 本机 / 远端资源面板：本地 1 秒、远端 2 秒采样一次。 */
export function MonitorPanel({
  sessionId,
  targetLabel,
  connectionName,
  processSort,
  onProcessSortChange,
  dock,
  onMove,
  canPanelMoveUp,
  canPanelMoveDown,
  onPanelReorder,
}: MonitorPanelProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setStats(null);
    setError(null);

    const tick = async (): Promise<void> => {
      const result = sessionId
        ? await window.eterm.getRemoteStats(sessionId)
        : await window.eterm.getSystemStats();
      if (cancelled) return;
      if (result.ok) {
        setStats(result.value);
        setError(null);
      } else {
        setStats(null);
        setError(result.error.message);
      }
      timer = window.setTimeout(() => void tick(), sessionId ? REMOTE_POLL_INTERVAL : POLL_INTERVAL);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [sessionId]);

  const memoryPercent = stats && stats.memTotal > 0 ? Math.round((stats.memUsed / stats.memTotal) * 100) : 0;
  const processList =
    processSort === 'cpu'
      ? (stats?.processesByCpu?.length ? stats.processesByCpu : (stats?.processes ?? []))
      : (stats?.processes ?? []);

  return (
    <PanelFrame
      panelId="monitor"
      title={sessionId ? '系统资源 · 远端' : '系统资源 · 本机'}
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
    >
      <div className="monitor-panel__body">
        <div className={`monitor-source ${sessionId ? 'monitor-source--remote' : ''}`} data-testid="monitor-source">
          <span className="monitor-source__badge" data-testid="monitor-source-badge">
            {sessionId ? '远端' : '本机'}
          </span>
          <span className="monitor-source__name" title={connectionName ?? targetLabel} data-testid="monitor-source-name">
            {connectionName ?? (sessionId ? '远端主机' : '这台 Mac')}
          </span>
          {sessionId ? (
            <span className="monitor-source__target" title={targetLabel}>
              {targetLabel}
            </span>
          ) : null}
        </div>

        <div className="monitor-section-title">资源</div>

        <div className="monitor-row">
          <span>主机名</span>
          <span className="monitor-row__value" data-testid="monitor-hostname">
            {stats?.hostname ?? '—'}
          </span>
        </div>
        <div className="monitor-row">
          <span>CPU</span>
          <span className="monitor-row__value" data-testid="monitor-cpu">
            {stats ? `${stats.cpuPercent}%` : '—'}
          </span>
        </div>
        <div className="monitor-meter">
          <span className="monitor-meter__fill" style={{ width: `${stats?.cpuPercent ?? 0}%` }} />
        </div>

        <div className="monitor-row">
          <span>内存</span>
          <span className="monitor-row__value" data-testid="monitor-memory">
            {stats ? `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)} · ${memoryPercent}%` : '—'}
          </span>
        </div>
        <div className="monitor-meter">
          <span className="monitor-meter__fill" style={{ width: `${memoryPercent}%` }} />
        </div>

        <div className="monitor-row">
          <span>负载</span>
          <span className="monitor-row__value" data-testid="monitor-load">
            {stats ? stats.load.map((value) => value.toFixed(2)).join(' / ') : '—'}
          </span>
        </div>

        <div className="monitor-row">
          <span>CPU 核数</span>
          <span className="monitor-row__value">{stats?.cpus ?? '—'}</span>
        </div>

        <div className="monitor-row">
          <span>运行时间</span>
          <span className="monitor-row__value" data-testid="monitor-uptime">
            {stats ? formatUptime(stats.uptime) : '—'}
          </span>
        </div>

        {stats?.filesystems?.length ? (
          <div className="monitor-filesystems" data-testid="monitor-filesystems">
            <div className="monitor-section-title">文件系统</div>
            {stats.filesystems.map((item) => {
              const percent = item.total > 0 ? Math.min(100, Math.round((item.used / item.total) * 100)) : 0;
              const tone = percent >= 90 ? 'danger' : percent >= 80 ? 'warning' : undefined;
              return (
                <div className="monitor-fs" key={item.path}>
                  <div className="monitor-fs__head">
                    <span className="monitor-fs__path" title={item.path}>
                      {item.path}
                    </span>
                    <span className="monitor-row__value">
                      {formatBytes(item.used)} / {formatBytes(item.total)} · {percent}%
                    </span>
                  </div>
                  <div className="monitor-meter">
                    <span className="monitor-meter__fill" data-tone={tone} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {processList.length ? (
          <div className="monitor-processes" data-testid="monitor-processes" data-sort={processSort}>
            <div className="monitor-section-head">
              <div className="monitor-section-title">占用最高进程</div>
              <div className="monitor-sort" role="group" aria-label="进程排序">
                <button
                  type="button"
                  className={processSort === 'memory' ? 'is-active' : ''}
                  data-testid="process-sort-memory"
                  onClick={() => onProcessSortChange('memory')}
                >
                  内存
                </button>
                <button
                  type="button"
                  className={processSort === 'cpu' ? 'is-active' : ''}
                  data-testid="process-sort-cpu"
                  onClick={() => onProcessSortChange('cpu')}
                >
                  CPU
                </button>
              </div>
            </div>
            {processList.map((proc) => (
              <div className="monitor-process" key={`${proc.pid}-${proc.name}`}>
                <span className="monitor-process__name" title={proc.name}>
                  {proc.name}
                </span>
                <span className="monitor-process__meta">
                  {formatBytes(proc.rss)} · {proc.cpuPercent.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="monitor-error" data-testid="monitor-error">
            {error}
          </p>
        ) : null}
      </div>
    </PanelFrame>
  );
}

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
