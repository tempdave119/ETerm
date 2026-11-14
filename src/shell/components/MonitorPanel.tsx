import { useEffect, useState } from 'react';
import type { DockId } from '../../shared/panels.ts';
import type { SystemStats } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
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
      title={t('panel.monitor')}
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
    >
      <div className="monitor-panel__body">
        <div className={`monitor-source ${sessionId ? 'monitor-source--remote' : ''}`} data-testid="monitor-source">
          <span className="monitor-source__badge" data-testid="monitor-source-badge">
            {sessionId ? t('monitor.remote') : t('monitor.local')}
          </span>
          <span className="monitor-source__name" title={connectionName ?? targetLabel} data-testid="monitor-source-name">
            {connectionName ?? (sessionId ? t('app.remoteHost') : t('app.thisMac'))}
          </span>
          <span className="monitor-source__host" data-testid="monitor-hostname">
            {stats?.hostname ?? t('common.notAvailable')}
          </span>
          {sessionId ? (
            <span className="monitor-source__target" title={targetLabel}>
              {targetLabel}
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="monitor-error" data-testid="monitor-error">
            {error}
          </div>
        ) : !stats ? (
          <div className="monitor-loading">{t('monitor.sampling')}</div>
        ) : (
          <>
            <section className="monitor-section">
              <div className="monitor-metrics">
                <div className="monitor-metric">
                  <div className="monitor-metric__head">
                    <span className="monitor-metric__label">CPU</span>
                    <strong className="monitor-metric__value" data-testid="monitor-cpu">
                      {stats.cpuPercent}%
                    </strong>
                  </div>
                  <div className="monitor-meter monitor-meter--metric">
                    <span className="monitor-meter__fill" style={{ width: `${stats.cpuPercent}%` }} />
                  </div>
                  <div className="monitor-metric__sub">
                    <span>{t('monitor.cores', { count: stats.cpus })}</span>
                    <span data-testid="monitor-uptime">{formatUptime(stats.uptime)}</span>
                  </div>
                </div>

                <div className="monitor-metric">
                  <div className="monitor-metric__head">
                    <span className="monitor-metric__label">{t('monitor.memory')}</span>
                    <strong className="monitor-metric__value" data-testid="monitor-memory-percent">
                      {memoryPercent}%
                    </strong>
                  </div>
                  <div className="monitor-meter monitor-meter--metric">
                    <span className="monitor-meter__fill" style={{ width: `${memoryPercent}%` }} />
                  </div>
                  <div className="monitor-metric__sub">
                    <span data-testid="monitor-memory">
                      {formatBytes(stats.memUsed)} / {formatBytes(stats.memTotal)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="monitor-fact-row">
                <span>{t('monitor.load')}</span>
                <span className="monitor-row__value" data-testid="monitor-load">
                  {stats.load.map((value) => value.toFixed(2)).join(' / ')}
                </span>
              </div>
            </section>

            {stats.filesystems?.length ? (
              <section className="monitor-section" data-testid="monitor-filesystems">
                <div className="monitor-section-title">{t('monitor.filesystems')}</div>
                {stats.filesystems.map((item) => {
                  const percent = item.total > 0 ? Math.min(100, Math.round((item.used / item.total) * 100)) : 0;
                  const tone = percent >= 90 ? 'danger' : percent >= 80 ? 'warning' : null;
                  return (
                    <div className="monitor-fs" key={item.path}>
                      <div className="monitor-fs__head">
                        <span className="monitor-fs__path" title={item.path}>
                          {item.path}
                        </span>
                        <span className={`monitor-fs__percent${tone ? ` is-${tone}` : ''}`}>{percent}%</span>
                      </div>
                      <div className="monitor-fs__meta">
                        {formatBytes(item.used)} / {formatBytes(item.total)}
                      </div>
                      <div className="monitor-meter">
                        <span className="monitor-meter__fill" data-tone={tone ?? undefined} style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })}
              </section>
            ) : null}

            {processList.length ? (
              <section className="monitor-section" data-testid="monitor-processes" data-sort={processSort}>
                <div className="monitor-section-head">
                  <div className="monitor-section-title">{t('monitor.processes')}</div>
                  <div className="monitor-sort-wrap">
                    <span className="monitor-sort__label">{t('monitor.sortBy')}</span>
                    <div className="monitor-sort" role="group" aria-label={t('monitor.sortGroup')}>
                      <button
                        type="button"
                        className={processSort === 'memory' ? 'is-active' : ''}
                        data-testid="process-sort-memory"
                        aria-pressed={processSort === 'memory'}
                        title={t('monitor.sortMemory')}
                        onClick={() => onProcessSortChange('memory')}
                      >
                        {t('monitor.sort.memory')}
                      </button>
                      <button
                        type="button"
                        className={processSort === 'cpu' ? 'is-active' : ''}
                        data-testid="process-sort-cpu"
                        aria-pressed={processSort === 'cpu'}
                        title={t('monitor.sortCpu')}
                        onClick={() => onProcessSortChange('cpu')}
                      >
                        CPU
                      </button>
                    </div>
                  </div>
                </div>
                <div className="monitor-process-list">
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
              </section>
            ) : null}
          </>
        )}
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
