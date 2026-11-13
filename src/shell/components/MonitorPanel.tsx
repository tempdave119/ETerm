import { useEffect, useState } from 'react';
import type { DockId } from '../../shared/panels.ts';
import type { SystemStats } from '../../shared/ipc.ts';
import { PanelFrame } from './PanelFrame.tsx';

interface MonitorPanelProps {
  dock: DockId | null;
  onMove(target: DockId | null): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

const POLL_INTERVAL = 1000;

/** 本机资源面板：每秒拉一次 system:stats；第一次采样只建立 CPU 基线。 */
export function MonitorPanel({ dock, onMove, canPanelMoveUp, canPanelMoveDown, onPanelReorder }: MonitorPanelProps) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async (): Promise<void> => {
      const result = await window.eterm.getSystemStats();
      if (cancelled) return;
      if (result.ok) setStats(result.value);
      timer = window.setTimeout(() => void tick(), POLL_INTERVAL);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const memoryPercent = stats && stats.memTotal > 0 ? Math.round((stats.memUsed / stats.memTotal) * 100) : 0;

  return (
    <PanelFrame
      panelId="monitor"
      title="系统资源"
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
    >
      <div className="monitor-panel__body">
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
            {stats ? `${formatBytes(stats.memUsed)} / ${formatBytes(stats.memTotal)}` : '—'}
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
      </div>
    </PanelFrame>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
