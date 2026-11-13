import { useEffect, useState } from 'react';
import type { ConnectionInput, ConnectionRecord, GroupRecord } from '../../shared/ipc.ts';

export interface FormSecrets {
  password?: string;
  passphrase?: string;
}

interface ConnectionFormProps {
  groups: GroupRecord[];
  connections: ConnectionRecord[];
  editing: ConnectionRecord | null;
  hasStoredPassword: boolean;
  hasStoredPassphrase: boolean;
  submitting: boolean;
  error: string | null;
  onCancel(): void;
  onSubmit(input: ConnectionInput, secrets: FormSecrets, connectAfter: boolean): void;
}

export function ConnectionForm({
  groups,
  connections,
  editing,
  hasStoredPassword,
  hasStoredPassphrase,
  submitting,
  error,
  onCancel,
  onSubmit,
}: ConnectionFormProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [host, setHost] = useState(editing?.host ?? '');
  const [port, setPort] = useState(String(editing?.port ?? 22));
  const [username, setUsername] = useState(editing?.username ?? '');
  const [auth, setAuth] = useState(editing?.auth ?? 'password');
  const [groupId, setGroupId] = useState(editing?.groupId ?? '');
  const [keyPath, setKeyPath] = useState(editing?.keyPath ?? '');
  const [jumpConnectionId, setJumpConnectionId] = useState(editing?.jumpConnectionId ?? '');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const submit = (connectAfter: boolean): void => {
    setLocalError(null);
    const portNumber = Number(port);

    if (!name.trim()) return setLocalError('请填写连接名称');
    if (!host.trim()) return setLocalError('请填写主机');
    if (!username.trim()) return setLocalError('请填写用户名');
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return setLocalError('端口必须是 1–65535 的整数');
    }
    if (auth === 'password' && !hasStoredPassword && !password) {
      return setLocalError('请填写密码');
    }
    if (auth === 'key' && !keyPath.trim()) {
      return setLocalError('请选择私钥文件路径');
    }

    const input: ConnectionInput = {
      id: editing?.id,
      name: name.trim(),
      protocol: 'ssh',
      host: host.trim(),
      port: portNumber,
      username: username.trim(),
      auth,
      groupId: groupId || null,
      keyPath: auth === 'key' ? keyPath.trim() : undefined,
      jumpConnectionId: jumpConnectionId || null,
    };

    onSubmit(
      input,
      {
        password: auth === 'password' && password ? password : undefined,
        passphrase: auth === 'key' && passphrase ? passphrase : undefined,
      },
      connectAfter,
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? '编辑连接' : '新建连接'}>
        <h2 className="modal__title">{editing ? '编辑连接' : '新建连接'}</h2>

        <div className="form-row">
          <label htmlFor="connection-name">名称</label>
          <input
            id="connection-name"
            autoFocus
            value={name}
            placeholder="例如：生产 web-01"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="connection-host">主机</label>
            <input
              id="connection-host"
              value={host}
              placeholder="10.0.0.1 或 example.com"
              onChange={(event) => setHost(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="connection-port">端口</label>
            <input
              id="connection-port"
              value={port}
              inputMode="numeric"
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
        </div>

        <div className="form-row">
          <label htmlFor="connection-user">用户名</label>
          <input
            id="connection-user"
            value={username}
            placeholder="root"
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>

        <div className="form-row">
          <label htmlFor="connection-auth">认证方式</label>
          <select
            id="connection-auth"
            value={auth}
            onChange={(event) => setAuth(event.target.value as ConnectionInput['auth'] ?? 'password')}
          >
            <option value="password">密码</option>
            <option value="key">私钥</option>
            <option value="agent">SSH agent</option>
          </select>
        </div>

        {auth === 'password' ? (
          <div className="form-row">
            <label htmlFor="connection-password">密码</label>
            <input
              id="connection-password"
              type="password"
              value={password}
              placeholder={hasStoredPassword ? '已保存，留空保持不变' : '登录密码'}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        ) : null}

        {auth === 'key' ? (
          <>
            <div className="form-row">
              <label htmlFor="connection-key">私钥路径</label>
              <input
                id="connection-key"
                value={keyPath}
                placeholder="~/.ssh/id_ed25519"
                onChange={(event) => setKeyPath(event.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="connection-passphrase">私钥口令</label>
              <input
                id="connection-passphrase"
                type="password"
                value={passphrase}
                placeholder={hasStoredPassphrase ? '已保存，留空保持不变' : '没有口令可留空'}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </div>
          </>
        ) : null}

        {auth === 'agent' ? <p className="form-hint">使用当前 SSH_AUTH_SOCK；没有启动 agent 时会提示。</p> : null}

        <div className="form-row">
          <label htmlFor="connection-jump">经由跳板机</label>
          <select
            id="connection-jump"
            data-testid="connection-jump"
            value={jumpConnectionId}
            onChange={(event) => setJumpConnectionId(event.target.value)}
          >
            <option value="">不使用</option>
            {connections
              .filter((connection) => connection.protocol === 'ssh' && connection.id !== editing?.id)
              .map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name}（{connection.host}）
                </option>
              ))}
          </select>
        </div>

        <div className="form-row">
          <label htmlFor="connection-group">分组</label>
          <select id="connection-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">未分组</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>

        {localError || error ? <p className="form-error">{localError ?? error}</p> : null}

        <div className="modal__actions">
          <button className="button" type="button" onClick={onCancel} disabled={submitting}>
            取消
          </button>
          <button
            className="button"
            type="button"
            data-testid="connection-save"
            onClick={() => submit(false)}
            disabled={submitting}
          >
            保存
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="connection-save-connect"
            onClick={() => submit(true)}
            disabled={submitting}
          >
            保存并连接
          </button>
        </div>
      </div>
    </div>
  );
}
