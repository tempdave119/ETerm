export type ConnectionProtocol = string;
export type AuthMethod = 'password' | 'key' | 'agent' | 'none';
export type ProxyType = 'http' | 'socks5';

export interface ConnectionProxy {
  type: ProxyType;
  host: string;
  port: number;
  /** 代理用户名；密码不进 connections.json，存凭据库（proxy-password）。 */
  username?: string;
}

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
  /** 直连代理；走跳板时忽略。 */
  proxy?: ConnectionProxy;
  /** 可选组件的协议字段（如串口设备路径 / 波特率），宿主不解释内容。 */
  options?: Record<string, string>;
  /** 备注，可选；会话树不展示，仅编辑时回填。 */
  note?: string;
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
  proxy?: ConnectionProxy | null;
  options?: Record<string, string> | null;
  note?: string | null;
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
