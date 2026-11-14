import { useEffect, useState } from 'react';
import type {
  ComponentDescriptor,
  ComponentField,
  ConnectionInput,
  ConnectionRecord,
  GroupRecord,
} from '../../shared/ipc.ts';

export interface FormSecrets {
  password?: string;
  passphrase?: string;
}

interface ConnectionFormProps {
  groups: GroupRecord[];
  connections: ConnectionRecord[];
  components: ComponentDescriptor[];
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
  components,
  editing,
  hasStoredPassword,
  hasStoredPassphrase,
  submitting,
  error,
  onCancel,
  onSubmit,
}: ConnectionFormProps) {
  const [name, setName] = useState(editing?.name ?? '');
  const [protocol, setProtocol] = useState(editing?.protocol ?? 'ssh');
  const [host, setHost] = useState(editing?.host ?? '');
  const [port, setPort] = useState(String(editing?.port ?? 22));
  const [username, setUsername] = useState(editing?.username ?? '');
  const [auth, setAuth] = useState(editing?.auth ?? 'password');
  const [groupId, setGroupId] = useState(editing?.groupId ?? '');
  const [keyPath, setKeyPath] = useState(editing?.keyPath ?? '');
  const [jumpConnectionId, setJumpConnectionId] = useState(editing?.jumpConnectionId ?? '');
  const [proxyType, setProxyType] = useState<'none' | 'http' | 'socks5'>(editing?.proxy?.type ?? 'none');
  const [proxyHost, setProxyHost] = useState(editing?.proxy?.host ?? '');
  const [proxyPort, setProxyPort] = useState(String(editing?.proxy?.port ?? 1080));
  const [options, setOptions] = useState<Record<string, string>>(editing?.options ?? {});
  const [note, setNote] = useState(editing?.note ?? '');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isSsh = protocol === 'ssh';
  const component = components.find((item) => item.protocol === protocol) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const selectProtocol = (value: string): void => {
    setProtocol(value);
    const next = components.find((item) => item.protocol === value);
    if (!next) return;
    setOptions((current) => {
      const merged = { ...current };
      for (const field of next.fields) {
        if (merged[field.key] === undefined) merged[field.key] = field.default ?? '';
      }
      return merged;
    });
  };

  const setOption = (key: string, value: string): void => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const submit = (connectAfter: boolean): void => {
    setLocalError(null);
    if (!name.trim()) return setLocalError('请填写连接名称');

    const noteValue = note.trim() || null;

    if (!isSsh) {
      for (const field of component?.fields ?? []) {
        if (field.required && !(options[field.key] ?? '').trim()) {
          return setLocalError(`请填写${field.label}`);
        }
      }
      onSubmit(
        {
          id: editing?.id,
          name: name.trim(),
          protocol,
          groupId: groupId || null,
          options,
          note: noteValue,
        },
        {},
        connectAfter,
      );
      return;
    }

    const portNumber = Number(port);
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
    if (proxyType !== 'none') {
      if (!proxyHost.trim()) return setLocalError('请填写代理地址');
      const proxyPortNumber = Number(proxyPort);
      if (!Number.isInteger(proxyPortNumber) || proxyPortNumber < 1 || proxyPortNumber > 65535) {
        return setLocalError('代理端口必须是 1–65535 的整数');
      }
    }

    onSubmit(
      {
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
        proxy:
          proxyType === 'none'
            ? null
            : { type: proxyType, host: proxyHost.trim(), port: Number(proxyPort) },
        note: noteValue,
      },
      {
        password: auth === 'password' && password ? password : undefined,
        passphrase: auth === 'key' && passphrase ? passphrase : undefined,
      },
      connectAfter,
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal modal--form" role="dialog" aria-modal="true" aria-label={editing ? '编辑连接' : '新建连接'}>
        <h2 className="modal__title">{editing ? '编辑连接' : '新建连接'}</h2>

        <div className="form-body">
          <div className="form-columns">
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
          </div>

          <div className="form-columns">
            <div className="form-row">
              <label htmlFor="connection-protocol">协议</label>
              <select
                id="connection-protocol"
                data-testid="connection-protocol"
                value={protocol}
                onChange={(event) => selectProtocol(event.target.value)}
              >
                <option value="ssh">SSH</option>
                {components.map((item) => (
                  <option key={item.id} value={item.protocol}>
                    {item.label}
                  </option>
                ))}
                {!isSsh && !component ? <option value={protocol}>{protocol}（组件未装载）</option> : null}
              </select>
            </div>
            {isSsh ? (
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
            ) : null}
          </div>

          {isSsh ? (
            <>
              <div className="form-columns">
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

              <div className="form-columns">
                <div className="form-row">
                  <label htmlFor="connection-user">用户名</label>
                  <input
                    id="connection-user"
                    value={username}
                    placeholder="root"
                    onChange={(event) => setUsername(event.target.value)}
                  />
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
                ) : auth === 'key' ? (
                  <div className="form-row">
                    <label htmlFor="connection-key">私钥路径</label>
                    <input
                      id="connection-key"
                      value={keyPath}
                      placeholder="~/.ssh/id_ed25519"
                      onChange={(event) => setKeyPath(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              {auth === 'key' ? (
                <div className="form-columns">
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
                </div>
              ) : null}

              {auth === 'agent' ? <p className="form-hint">使用当前 SSH_AUTH_SOCK；没有启动 agent 时会提示。</p> : null}

              <div className="form-columns">
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
                  <label htmlFor="connection-proxy-type">代理</label>
                  <select
                    id="connection-proxy-type"
                    data-testid="connection-proxy-type"
                    value={proxyType}
                    onChange={(event) => setProxyType(event.target.value as 'none' | 'http' | 'socks5')}
                  >
                    <option value="none">不使用</option>
                    <option value="http">HTTP 代理</option>
                    <option value="socks5">SOCKS5 代理</option>
                  </select>
                </div>
              </div>

              {proxyType !== 'none' ? (
                <>
                  <div className="form-columns">
                    <div className="form-row">
                      <label htmlFor="connection-proxy-host">代理地址</label>
                      <input
                        id="connection-proxy-host"
                        value={proxyHost}
                        placeholder="127.0.0.1"
                        onChange={(event) => setProxyHost(event.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor="connection-proxy-port">端口</label>
                      <input
                        id="connection-proxy-port"
                        value={proxyPort}
                        inputMode="numeric"
                        onChange={(event) => setProxyPort(event.target.value)}
                      />
                    </div>
                  </div>
                  <p className="form-hint">代理只用于直连；已设置跳板机时忽略。首版不支持代理认证。</p>
                </>
              ) : null}
            </>
          ) : null}

          {component ? (
            <>
              <div className="form-columns">
                {component.fields.map((field) => (
                  <ComponentFieldRow
                    key={field.key}
                    field={field}
                    value={options[field.key] ?? field.default ?? ''}
                    onChange={(value) => setOption(field.key, value)}
                  />
                ))}
              </div>
              <p className="form-hint">字段由组件「{component.label}」提供，宿主只负责保存与透传。</p>
            </>
          ) : null}

          <div className="form-row">
            <label htmlFor="connection-note">备注</label>
            <textarea
              id="connection-note"
              data-testid="connection-note"
              rows={3}
              maxLength={200}
              value={note}
              placeholder="可选，例如用途说明"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {localError || error ? <p className="form-error">{localError ?? error}</p> : null}
        </div>

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

function ComponentFieldRow({
  field,
  value,
  onChange,
}: {
  field: ComponentField;
  value: string;
  onChange(value: string): void;
}) {
  const id = `connection-option-${field.key}`;
  return (
    <div className="form-row">
      <label htmlFor={id}>{field.label}</label>
      {field.type === 'select' ? (
        <select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          data-testid={id}
          value={value}
          inputMode={field.type === 'number' ? 'numeric' : undefined}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}
