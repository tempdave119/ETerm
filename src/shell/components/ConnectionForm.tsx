import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  ComponentDescriptor,
  ComponentField,
  ConnectionInput,
  ConnectionRecord,
  GroupRecord,
  SerialDevice,
} from '../../shared/ipc.ts';
import { t } from '../../shared/i18n/index.ts';

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
  const [serialDevices, setSerialDevices] = useState<SerialDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const isSsh = protocol === 'ssh';
  const component = components.find((item) => item.protocol === protocol) ?? null;
  const needsDevices = Boolean(component?.fields.some((field) => field.optionsSource === 'serial-devices'));

  const refreshSerialDevices = useCallback(async (): Promise<void> => {
    setDevicesLoading(true);
    try {
      const result = await window.eterm.listSerialDevices();
      setSerialDevices(result.ok ? result.value : []);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (needsDevices) void refreshSerialDevices();
  }, [needsDevices, refreshSerialDevices]);

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
    if (!name.trim()) return setLocalError(t('connection.nameRequired'));

    const noteValue = note.trim() || null;

    if (!isSsh) {
      for (const field of component?.fields ?? []) {
        if (field.required && !(options[field.key] ?? '').trim()) {
          return setLocalError(t('connection.fieldRequired', { name: field.label }));
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
    if (!host.trim()) return setLocalError(t('connection.hostRequired'));
    if (!username.trim()) return setLocalError(t('connection.userRequired'));
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return setLocalError(t('connection.portInvalid'));
    }
    if (auth === 'password' && !hasStoredPassword && !password) {
      return setLocalError(t('connection.passwordRequired'));
    }
    if (auth === 'key' && !keyPath.trim()) {
      return setLocalError(t('connection.keyRequired'));
    }
    if (proxyType !== 'none') {
      if (!proxyHost.trim()) return setLocalError(t('connection.proxyHostRequired'));
      const proxyPortNumber = Number(proxyPort);
      if (!Number.isInteger(proxyPortNumber) || proxyPortNumber < 1 || proxyPortNumber > 65535) {
        return setLocalError(t('connection.proxyPortInvalid'));
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
      <div className="modal modal--form" role="dialog" aria-modal="true" aria-label={editing ? t('connection.edit') : t('connection.new')}>
        <h2 className="modal__title">{editing ? t('connection.edit') : t('connection.new')}</h2>

        <div className="form-body">
          <div className="form-columns">
            <div className="form-row">
              <label htmlFor="connection-name">{t('connection.name')}</label>
              <input
                id="connection-name"
                autoFocus
                value={name}
                placeholder={t('connection.namePlaceholder')}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="connection-group">{t('connection.group')}</label>
              <select id="connection-group" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">{t('connection.ungrouped')}</option>
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
              <label htmlFor="connection-protocol">{t('connection.protocol')}</label>
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
                {!isSsh && !component ? <option value={protocol}>{t('connection.protocolUnloaded', { protocol })}</option> : null}
              </select>
            </div>
            {isSsh ? (
              <div className="form-row">
                <label htmlFor="connection-auth">{t('connection.auth')}</label>
                <select
                  id="connection-auth"
                  value={auth}
                  onChange={(event) => setAuth(event.target.value as ConnectionInput['auth'] ?? 'password')}
                >
                  <option value="password">{t('connection.auth.password')}</option>
                  <option value="key">{t('connection.auth.key')}</option>
                  <option value="agent">{t('connection.auth.agent')}</option>
                </select>
              </div>
            ) : null}
          </div>

          {isSsh ? (
            <>
              <div className="form-columns">
                <div className="form-row">
                  <label htmlFor="connection-host">{t('connection.host')}</label>
                  <input
                    id="connection-host"
                    value={host}
                    placeholder={t('connection.hostPlaceholder')}
                    onChange={(event) => setHost(event.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="connection-port">{t('connection.port')}</label>
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
                  <label htmlFor="connection-user">{t('connection.username')}</label>
                  <input
                    id="connection-user"
                    value={username}
                    placeholder="root"
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
                {auth === 'password' ? (
                  <div className="form-row">
                    <label htmlFor="connection-password">{t('connection.password')}</label>
                    <input
                      id="connection-password"
                      type="password"
                      value={password}
                      placeholder={hasStoredPassword ? t('connection.passwordStored') : t('connection.passwordPlaceholder')}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>
                ) : auth === 'key' ? (
                  <div className="form-row">
                    <label htmlFor="connection-key">{t('connection.keyPath')}</label>
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
                    <label htmlFor="connection-passphrase">{t('connection.passphrase')}</label>
                    <input
                      id="connection-passphrase"
                      type="password"
                      value={passphrase}
                      placeholder={hasStoredPassphrase ? t('connection.passwordStored') : t('connection.passphrasePlaceholder')}
                      onChange={(event) => setPassphrase(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}

              {auth === 'agent' ? <p className="form-hint">{t('connection.agentHint')}</p> : null}

              <div className="form-columns">
                <div className="form-row">
                  <label htmlFor="connection-jump">{t('connection.jump')}</label>
                  <select
                    id="connection-jump"
                    data-testid="connection-jump"
                    value={jumpConnectionId}
                    onChange={(event) => setJumpConnectionId(event.target.value)}
                  >
                    <option value="">{t('connection.jumpNone')}</option>
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
                  <label htmlFor="connection-proxy-type">{t('connection.proxy')}</label>
                  <select
                    id="connection-proxy-type"
                    data-testid="connection-proxy-type"
                    value={proxyType}
                    onChange={(event) => setProxyType(event.target.value as 'none' | 'http' | 'socks5')}
                  >
                    <option value="none">{t('connection.proxyNone')}</option>
                    <option value="http">{t('connection.proxyHttp')}</option>
                    <option value="socks5">{t('connection.proxySocks5')}</option>
                  </select>
                </div>
              </div>

              {proxyType !== 'none' ? (
                <>
                  <div className="form-columns">
                    <div className="form-row">
                      <label htmlFor="connection-proxy-host">{t('connection.proxyHost')}</label>
                      <input
                        id="connection-proxy-host"
                        value={proxyHost}
                        placeholder="127.0.0.1"
                        onChange={(event) => setProxyHost(event.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <label htmlFor="connection-proxy-port">{t('connection.proxyPort')}</label>
                      <input
                        id="connection-proxy-port"
                        value={proxyPort}
                        inputMode="numeric"
                        onChange={(event) => setProxyPort(event.target.value)}
                      />
                    </div>
                  </div>
                  <p className="form-hint">{t('connection.proxyHint')}</p>
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
                    devices={serialDevices}
                    devicesLoading={devicesLoading}
                    onRefreshDevices={() => void refreshSerialDevices()}
                    onChange={(value) => setOption(field.key, value)}
                  />
                ))}
              </div>
              <p className="form-hint">{t('connection.optionsHint', { name: component.label })}</p>
            </>
          ) : null}

          <div className="form-row">
            <label htmlFor="connection-note">{t('connection.note')}</label>
            <textarea
              id="connection-note"
              data-testid="connection-note"
              rows={3}
              maxLength={200}
              value={note}
              placeholder={t('connection.notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {localError || error ? <p className="form-error">{localError ?? error}</p> : null}
        </div>

        <div className="modal__actions">
          <button className="button" type="button" onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            className="button"
            type="button"
            data-testid="connection-save"
            onClick={() => submit(false)}
            disabled={submitting}
          >
            {t('connection.save')}
          </button>
          <button
            className="button button--primary"
            type="button"
            data-testid="connection-save-connect"
            onClick={() => submit(true)}
            disabled={submitting}
          >
            {t('connection.saveConnect')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentFieldRow({
  field,
  value,
  devices,
  devicesLoading,
  onRefreshDevices,
  onChange,
}: {
  field: ComponentField;
  value: string;
  devices: SerialDevice[];
  devicesLoading: boolean;
  onRefreshDevices(): void;
  onChange(value: string): void;
}) {
  const id = `connection-option-${field.key}`;

  if (field.type === 'boolean') {
    return (
      <label className="settings-check">
        <input
          type="checkbox"
          data-testid={id}
          checked={value !== 'false'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
        />
        {field.label}
      </label>
    );
  }

  // 动态选项由宿主提供（串口设备列表），组件只声明 optionsSource。
  if (field.optionsSource === 'serial-devices') {
    return (
      <div className="form-row">
        <label htmlFor={id}>{field.label}</label>
        <div className="form-row__control">
          <select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)}>
            {devices.length === 0 ? <option value="">{t('connection.devices.empty')}</option> : null}
            {value && !devices.some((device) => device.path === value) ? (
              <option value={value}>{t('connection.devices.missing', { path: value })}</option>
            ) : null}
            {devices.map((device) => (
              <option key={device.path} value={device.path} title={device.path}>
                {device.label}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            title={t('connection.devices.refresh')}
            aria-label={t('connection.devices.refresh')}
            data-testid={`${id}-refresh`}
            disabled={devicesLoading}
            onClick={onRefreshDevices}
          >
            <RefreshCw size={13} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    );
  }

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
