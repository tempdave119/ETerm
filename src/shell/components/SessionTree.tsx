import { useState } from 'react';
import { Folder, FolderPlus, Pencil, Plus, Search, Server, Trash2 } from 'lucide-react';
import type { DockId } from '../../shared/panels.ts';
import type { ConnectionRecord, GroupRecord } from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';
import { PanelFrame } from './PanelFrame.tsx';

interface SessionTreeProps {
  groups: GroupRecord[];
  connections: ConnectionRecord[];
  activeConnectionId: string | null;
  /** 正在建立连接的连接 id；写入期间该行禁点，避免重复点出多个标签。 */
  connectingId: string | null;
  dock: DockId | null;
  onMove(target: DockId | null): void;
  query: string;
  onQueryChange(value: string): void;
  onConnect(connection: ConnectionRecord): void;
  onNew(): void;
  onEdit(connection: ConnectionRecord): void;
  onDelete(connection: ConnectionRecord): void;
  onAddGroup(name: string): void;
  onDeleteGroup(group: GroupRecord): void;
  onReorder(orderedIds: string[]): void;
  canPanelMoveUp?: boolean;
  canPanelMoveDown?: boolean;
  onPanelReorder?(delta: -1 | 1): void;
}

export function SessionTree({
  groups,
  connections,
  activeConnectionId,
  connectingId,
  dock,
  onMove,
  query,
  onQueryChange,
  onConnect,
  onNew,
  onEdit,
  onDelete,
  onAddGroup,
  onDeleteGroup,
  onReorder,
  canPanelMoveUp,
  canPanelMoveDown,
  onPanelReorder,
}: SessionTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? connections.filter((connection) =>
        [connection.name, connection.host, connection.username]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(keyword)),
      )
    : connections;

  const byGroup = new Map<string | null, ConnectionRecord[]>();
  for (const connection of filtered) {
    const key = connection.groupId ?? null;
    const list = byGroup.get(key) ?? [];
    list.push(connection);
    byGroup.set(key, list);
  }

  const toggleGroup = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitGroup = (): void => {
    const name = groupName.trim();
    if (!name) return;
    onAddGroup(name);
    setGroupName('');
    setAddingGroup(false);
  };

  const resetDrag = (): void => {
    setDraggingId(null);
    setDragOverId(null);
  };

  const dropOn = (targetId: string): void => {
    const sourceId = draggingId;
    resetDrag();
    if (!sourceId || sourceId === targetId) return;

    const ids = connections.map((connection) => connection.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    onReorder(ids);
  };

  return (
    <PanelFrame
      panelId="sessions"
      title={t('panel.sessions')}
      dock={dock}
      onMove={onMove}
      canMoveUp={canPanelMoveUp}
      canMoveDown={canPanelMoveDown}
      onReorder={onPanelReorder}
      actions={
        <>
          <button className="icon-button" type="button" title={t('tree.new')} aria-label={t('tree.new')} onClick={onNew}>
            <Plus size={15} strokeWidth={1.5} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={t('tree.newGroup')}
            aria-label={t('tree.newGroup')}
            onClick={() => setAddingGroup((value) => !value)}
          >
            <FolderPlus size={15} strokeWidth={1.5} />
          </button>
        </>
      }
    >
      <div className="session-tree__search">
        <Search className="search-icon" size={14} strokeWidth={1.5} />
        <input
          className="search-input"
          type="search"
          placeholder={t('tree.search')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      {addingGroup ? (
        <input
          className="search-input session-tree__group-input"
          autoFocus
          placeholder={t('tree.groupPlaceholder')}
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitGroup();
            if (event.key === 'Escape') setAddingGroup(false);
          }}
          onBlur={submitGroup}
        />
      ) : null}

      <div className="session-tree__list">
        {/* 分组独立于连接存在：组内连接删光后仍要显示空组，否则组名被占用却无从操作。 */}
        {connections.length === 0 && groups.length === 0 ? (
          <div className="tree-empty">
            <span>{t('tree.empty')}</span>
            <button className="button button--primary" type="button" onClick={onNew}>
              {t('tree.new')}
            </button>
          </div>
        ) : keyword && filtered.length === 0 ? (
          <div className="tree-empty">
            <span>{t('tree.noMatch')}</span>
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const children = byGroup.get(group.id) ?? [];
              if (keyword && children.length === 0) return null;
              const isCollapsed = !keyword && collapsed.has(group.id);
              return (
                <div key={group.id} className="tree-group">
                  {/* 外层用 div：组头里要放删除按钮，button 不能嵌套 button。 */}
                  <div className="tree-group__header">
                    <button className="tree-group__toggle" type="button" onClick={() => toggleGroup(group.id)}>
                      <Folder size={16} strokeWidth={1.5} />
                      <span className="tree-group__name">{group.name}</span>
                      <span className="tree-group__count">{children.length}</span>
                    </button>
                    <button
                      className="icon-button tree-group__delete"
                      type="button"
                      title={t('tree.deleteGroup')}
                      aria-label={t('tree.deleteGroupAria', { name: group.name })}
                      onClick={() => onDeleteGroup(group)}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                  {isCollapsed
                    ? null
                    : children.map((connection) => (
                        <ConnectionRow
                          key={connection.id}
                          connection={connection}
                          active={connection.id === activeConnectionId}
                          connecting={connectingId === connection.id}
                          dragEnabled={!keyword}
                          dragging={draggingId === connection.id}
                          dragOver={dragOverId === connection.id}
                          onDragStart={() => setDraggingId(connection.id)}
                          onDragOver={() => setDragOverId(connection.id)}
                          onDragEnd={resetDrag}
                          onDrop={() => dropOn(connection.id)}
                          onConnect={onConnect}
                          onEdit={onEdit}
                          onDelete={onDelete}
                        />
                      ))}
                </div>
              );
            })}

            {(byGroup.get(null) ?? []).length > 0 ? (
              <div className="tree-group">
                {groups.length > 0 ? <div className="tree-group__header tree-group__header--static">{t('tree.ungrouped')}</div> : null}
                {(byGroup.get(null) ?? []).map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    connection={connection}
                    active={connection.id === activeConnectionId}
                    connecting={connectingId === connection.id}
                    dragEnabled={!keyword}
                    dragging={draggingId === connection.id}
                    dragOver={dragOverId === connection.id}
                    onDragStart={() => setDraggingId(connection.id)}
                    onDragOver={() => setDragOverId(connection.id)}
                    onDragEnd={resetDrag}
                    onDrop={() => dropOn(connection.id)}
                    onConnect={onConnect}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </PanelFrame>
  );
}

interface ConnectionRowProps {
  connection: ConnectionRecord;
  active: boolean;
  connecting: boolean;
  dragEnabled: boolean;
  dragging: boolean;
  dragOver: boolean;
  onDragStart(): void;
  onDragOver(): void;
  onDragEnd(): void;
  onDrop(): void;
  onConnect(connection: ConnectionRecord): void;
  onEdit(connection: ConnectionRecord): void;
  onDelete(connection: ConnectionRecord): void;
}

function ConnectionRow({
  connection,
  active,
  connecting,
  dragEnabled,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onConnect,
  onEdit,
  onDelete,
}: ConnectionRowProps) {
  return (
    <div
      className="tree-connection"
      data-active={active}
      data-testid={`connection-row-${connection.name}`}
      data-dragging={dragging}
      data-drag-over={dragOver}
      draggable={dragEnabled}
      title={connection.host ? `${connection.name} · ${connection.host}` : connection.name}
      onDragStart={(event) => {
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', connection.id);
        }
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!dragEnabled) return;
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={() => {}}
      onDragEnd={onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <Server size={16} strokeWidth={1.5} className="tree-connection__icon" />
      <button
        className="tree-connection__main"
        type="button"
        disabled={connecting}
        data-testid={`connection-open-${connection.name}`}
        onClick={() => onConnect(connection)}
      >
        <span className="tree-connection__name">{connection.name}</span>
        {connecting ? (
          <span className="tree-connection__pending">{t('tree.connecting')}</span>
        ) : connection.host ? (
          <span className="tree-connection__host">{connection.host}</span>
        ) : null}
      </button>
      <span className="tree-connection__actions">
        <button
          className="icon-button"
          type="button"
          title={t('tree.editConnection')}
          aria-label={t('tree.editAria', { name: connection.name })}
          onClick={() => onEdit(connection)}
        >
          <Pencil size={14} strokeWidth={1.5} />
        </button>
        <button
          className="icon-button"
          type="button"
          title={t('tree.deleteConnection')}
          aria-label={t('tree.deleteAria', { name: connection.name })}
          onClick={() => onDelete(connection)}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}
