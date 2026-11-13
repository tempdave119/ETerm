export type ConnectionProtocol = 'ssh' | 'local';
export type AuthMethod = 'password' | 'key' | 'agent' | 'none';

export interface ConnectionRecord {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  host?: string;
  port?: number;
  username?: string;
  auth: AuthMethod;
  groupId: string | null;
  keyPath?: string;
  /** 跳板机：引用另一个已保存的 ssh 连接，复用它的凭据与指纹。 */
  jumpConnectionId?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupRecord {
  id: string;
  name: string;
  order: number;
}

export interface ConnectionsSnapshot {
  groups: GroupRecord[];
  connections: ConnectionRecord[];
}

export interface ConnectionInput {
  id?: string;
  name: string;
  protocol: ConnectionProtocol;
  host?: string;
  port?: number;
  username?: string;
  auth?: AuthMethod;
  groupId?: string | null;
  keyPath?: string;
  jumpConnectionId?: string | null;
}

export interface GroupInput {
  id?: string;
  name: string;
}

export const CONNECTIONS_FILE_VERSION = 1;

export interface ConnectionsFile {
  version: number;
  groups: GroupRecord[];
  connections: ConnectionRecord[];
}
