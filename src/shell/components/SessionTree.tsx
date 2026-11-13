import { useState } from 'react';
import { Folder, FolderPlus, Pencil, Plus, Search, Server, Trash2 } from 'lucide-react';
import type { ConnectionRecord, GroupRecord } from '../../shared/ipc.ts';

interface SessionTreeProps {
  groups: GroupRecord[];
  connections: ConnectionRecord[];
  activeConnectionId: string | null;
  query: string;
  onQueryChange(value: string): void;
  onConnect(connection: ConnectionRecord): void;
  onNew(): void;
  onEdit(connection: ConnectionRecord): void;
  onDelete(connection: ConnectionRecord): void;
  onAddGroup(name: string): void;
  onReorder(orderedIds: string[]): void;
}

export function SessionTree({
  groups,
  connections,
  activeConnectionId,
  query,
  onQueryChange,
  onConnect,
  onNew,
  onEdit,
  onDelete,
  onAddGroup,
  onReorder,
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
    <aside className="session-tree">
      <div className="session-tree__header">
        <span className="session-tree__title">会话</span>
        <button className="icon-button" type="button" title="新建连接" aria-label="新建连接" onClick={onNew}>
          <Plus size={16} strokeWidth={1.5} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="新建分组"
          aria-label="新建分组"
          onClick={() => setAddingGroup((value) => !value)}
        >
          <FolderPlus size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="session-tree__search">
        <Search className="search-icon" size={14} strokeWidth={1.5} />
        <input
          className="search-input"
          type="search"
          placeholder="搜索主机"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>

      {addingGroup ? (
        <input
          className="search-input session-tree__group-input"
          autoFocus
          placeholder="分组名称，回车确认"
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
        {connections.length === 0 ? (
          <div className="tree-empty">
            <span>还没有连接</span>
            <button className="button button--primary" type="button" onClick={onNew}>
              新建连接
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="tree-empty">
            <span>没有匹配的连接</span>
          </div>
        ) : (
          <>
            {groups.map((group) => {
              const children = byGroup.get(group.id) ?? [];
              if (keyword && children.length === 0) return null;
              const isCollapsed = !keyword && collapsed.has(group.id);
              return (
                <div key={group.id} className="tree-group">
                  <button className="tree-group__header" type="button" onClick={() => toggleGroup(group.id)}>
                    <Folder size={16} strokeWidth={1.5} />
                    <span className="tree-group__name">{group.name}</span>
                    <span className="tree-group__count">{children.length}</span>
                  </button>
                  {isCollapsed
                    ? null
                    : children.map((connection) => (
                        <ConnectionRow
                          key={connection.id}
                          connection={connection}
                          active={connection.id === activeConnectionId}
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
                {groups.length > 0 ? <div className="tree-group__header tree-group__header--static">未分组</div> : null}
                {(byGroup.get(null) ?? []).map((connection) => (
                  <ConnectionRow
                    key={connection.id}
                    connection={connection}
                    active={connection.id === activeConnectionId}
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
    </aside>
  );
}

interface ConnectionRowProps {
  connection: ConnectionRecord;
  active: boolean;
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
      <button className="tree-connection__main" type="button" onClick={() => onConnect(connection)}>
        <span className="tree-connection__name">{connection.name}</span>
        {connection.host ? <span className="tree-connection__host">{connection.host}</span> : null}
      </button>
      <span className="tree-connection__actions">
        <button
          className="icon-button"
          type="button"
          title="编辑"
          aria-label={`编辑 ${connection.name}`}
          onClick={() => onEdit(connection)}
        >
          <Pencil size={14} strokeWidth={1.5} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="删除"
          aria-label={`删除 ${connection.name}`}
          onClick={() => onDelete(connection)}
        >
          <Trash2 size={14} strokeWidth={1.5} />
        </button>
      </span>
    </div>
  );
}
