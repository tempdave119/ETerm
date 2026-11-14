import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Settings2, X } from 'lucide-react';
import { DOCK_IDS, type DockId, type PanelId } from '../../shared/panels.ts';
import { t, type MessageKey } from '../../shared/i18n/index.ts';

const DOCK_LABEL: Record<DockId, MessageKey> = {
  left: 'panel.dock.left',
  right: 'panel.dock.right',
  bottom: 'panel.dock.bottom',
};

interface PanelFrameProps {
  panelId: PanelId;
  title: string;
  /** 当前所在停靠区；不参与停靠时传 null（此时不显示齿轮与关闭）。 */
  dock: DockId | null;
  actions?: ReactNode;
  children: ReactNode;
  onMove(target: DockId | null): void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReorder?(delta: -1 | 1): void;
}

/**
 * 面板统一外壳：标题 + 自定义动作 + 齿轮菜单（换停靠区 / 关闭）。
 * 菜单是手写下拉，点击外部或 Escape 关闭，不引 UI 库。
 */
export function PanelFrame({
  panelId,
  title,
  dock,
  actions,
  children,
  onMove,
  canMoveUp = false,
  canMoveDown = false,
  onReorder,
}: PanelFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const pick = (target: DockId | null): void => {
    setMenuOpen(false);
    onMove(target);
  };

  return (
    <section className="panel-frame" ref={rootRef} data-panel-frame={panelId} data-testid={`panel-frame-${panelId}`}>
      <header className="panel-frame__header">
        <span className="panel-frame__title">{title}</span>
        {actions ? <span className="panel-frame__actions">{actions}</span> : null}
        {dock === null ? null : (
          <>
            <button
              className="icon-button"
              type="button"
              title={t('panel.move')}
              aria-label={t('panel.move')}
              data-testid={`panel-menu-${panelId}`}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Settings2 size={13} strokeWidth={1.5} />
            </button>
            <button
              className="icon-button"
              type="button"
              title={t('panel.close', { name: title })}
              aria-label={t('panel.close', { name: title })}
              data-testid={`panel-close-${panelId}`}
              onClick={() => onMove(null)}
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </>
        )}
        {menuOpen ? (
          <div className="panel-menu" role="menu" data-testid={`panel-menu-list-${panelId}`}>
            {onReorder ? (
              <>
                <button
                  className="panel-menu__item"
                  type="button"
                  role="menuitem"
                  data-testid={`panel-up-${panelId}`}
                  disabled={!canMoveUp}
                  onClick={() => {
                    setMenuOpen(false);
                    onReorder(-1);
                  }}
                >
                  {t('panel.moveUp')}
                </button>
                <button
                  className="panel-menu__item"
                  type="button"
                  role="menuitem"
                  data-testid={`panel-down-${panelId}`}
                  disabled={!canMoveDown}
                  onClick={() => {
                    setMenuOpen(false);
                    onReorder(1);
                  }}
                >
                  {t('panel.moveDown')}
                </button>
              </>
            ) : null}
            {DOCK_IDS.map((target) => (
              <button
                key={target}
                className="panel-menu__item"
                type="button"
                role="menuitem"
                data-testid={`panel-dock-${panelId}-${target}`}
                disabled={target === dock}
                onClick={() => pick(target)}
              >
                {t(DOCK_LABEL[target])}
              </button>
            ))}
            <button className="panel-menu__item" type="button" role="menuitem" onClick={() => pick(null)}>
              {t('panel.menuClose')}
            </button>
          </div>
        ) : null}
      </header>
      <div className="panel-frame__body">{children}</div>
    </section>
  );
}
