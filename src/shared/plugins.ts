/**
 * 插件（Plugin）manifest 契约：功能层包，可携带面板 / 命令 / 主题。
 * 扩展（Extension，kind: capability）见 docs/components.md；两者分目录、分 manifest。
 */

export const PLUGIN_KIND = 'plugin';
export const PLUGIN_FILE_VERSION = 1;

export const PLUGIN_PERMISSIONS = ['panel', 'command', 'theme', 'config'] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export type PluginDock = 'left' | 'right' | 'bottom';

export interface PluginPanelDeclaration {
  id: string;
  title: string;
  defaultDock?: PluginDock;
}

export interface PluginCommandDeclaration {
  id: string;
  title: string;
}

export interface PluginThemeDeclaration {
  id: string;
  title: string;
}

export interface PluginManifest {
  id: string;
  kind: typeof PLUGIN_KIND;
  apiVersion: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: PluginPermission[];
  panels: PluginPanelDeclaration[];
  commands: PluginCommandDeclaration[];
  themes: PluginThemeDeclaration[];
}

/** 列表 / 设置面板展示用：manifest 元数据 + 安装状态。 */
export interface PluginRecord {
  id: string;
  version: string;
  description: string;
  author: string;
  permissions: PluginPermission[];
  panels: PluginPanelDeclaration[];
  commands: PluginCommandDeclaration[];
  themes: PluginThemeDeclaration[];
  enabled: boolean;
}

/** 插件状态文件：只记禁用列表，目录存在即视为已安装。 */
export interface PluginsFile {
  version: number;
  disabled: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const API_VERSION_PATTERN = /^\^(\d+)\./;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象，实际是 ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0 || text.length > maxLength) {
    throw new Error(`${label} 必须是 1–${maxLength} 字符的字符串，实际是 ${JSON.stringify(value)}`);
  }
  return text;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parsePanels(value: unknown): PluginPanelDeclaration[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = asRecord(raw, 'panels 项');
    const id = asString(item.id, 'panels[].id', 64);
    if (!ID_PATTERN.test(id)) throw new Error(`panels[].id 不合法：${id}`);
    const dock = item.defaultDock;
    if (dock !== undefined && dock !== 'left' && dock !== 'right' && dock !== 'bottom') {
      throw new Error(`panels[].defaultDock 只能是 left / right / bottom，实际是 ${JSON.stringify(dock)}`);
    }
    return {
      id,
      title: asString(item.title, 'panels[].title', 120),
      ...(dock === undefined ? {} : { defaultDock: dock }),
    };
  });
}

function parseCommands(value: unknown): PluginCommandDeclaration[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = asRecord(raw, 'commands 项');
    return {
      id: asString(item.id, 'commands[].id', 64),
      title: asString(item.title, 'commands[].title', 120),
    };
  });
}

function parseThemes(value: unknown): PluginThemeDeclaration[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const item = asRecord(raw, 'themes 项');
    return {
      id: asString(item.id, 'themes[].id', 64),
      title: asString(item.title, 'themes[].title', 120),
    };
  });
}

function parsePermissions(value: unknown): PluginPermission[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('permissions 必须是数组');
  return value.map((raw) => {
    if (!PLUGIN_PERMISSIONS.includes(raw as PluginPermission)) {
      throw new Error(`permissions 只接受 ${PLUGIN_PERMISSIONS.join(' / ')}，实际是 ${JSON.stringify(raw)}`);
    }
    return raw as PluginPermission;
  });
}

/** 校验插件 manifest；任何字段不合规都抛错，调用方决定跳过还是提示用户。 */
export function parsePluginManifest(raw: unknown): PluginManifest {
  const value = asRecord(raw, '插件 manifest');
  if (value.kind !== PLUGIN_KIND) {
    throw new Error(`manifest.kind 必须是 ${PLUGIN_KIND}，实际是 ${JSON.stringify(value.kind)}`);
  }

  const id = asString(value.id, 'manifest.id', 64);
  if (!ID_PATTERN.test(id)) {
    throw new Error(`manifest.id 只能是小写字母 / 数字 / 连字符且以字母或数字开头，实际是 ${id}`);
  }

  const apiVersion = asString(value.apiVersion, 'manifest.apiVersion', 32);
  if (!API_VERSION_PATTERN.test(apiVersion)) {
    throw new Error(`manifest.apiVersion 必须是 ^x.y.z 形式，实际是 ${apiVersion}`);
  }

  const entry = asString(value.entry, 'manifest.entry', 256);
  if (entry.startsWith('/') || entry.split('/').includes('..')) {
    throw new Error(`manifest.entry 必须是插件目录内的相对路径，实际是 ${entry}`);
  }

  return {
    id,
    kind: PLUGIN_KIND,
    apiVersion,
    version: asString(value.version, 'manifest.version', 32),
    description: typeof value.description === 'string' ? value.description.trim() : '',
    author: typeof value.author === 'string' ? value.author.trim() : '',
    entry,
    permissions: parsePermissions(value.permissions),
    panels: parsePanels(value.panels),
    commands: parseCommands(value.commands),
    themes: parseThemes(value.themes),
  };
}

/** 与扩展同口径：只校验主版本，次版本与补丁由插件作者自行保证兼容。 */
export function isPluginApiCompatible(required: string, hostMajor: string): boolean {
  const match = API_VERSION_PATTERN.exec(required);
  return match !== null && match[1] === hostMajor;
}

export function pluginRecordOf(manifest: PluginManifest, enabled: boolean): PluginRecord {
  return {
    id: manifest.id,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    permissions: manifest.permissions,
    panels: manifest.panels,
    commands: manifest.commands,
    themes: manifest.themes,
    enabled,
  };
}

export function emptyPluginsFile(): PluginsFile {
  return { version: PLUGIN_FILE_VERSION, disabled: [] };
}

/** 状态文件同样按防御式解析：坏文件回退空列表，避免一个坏 JSON 阻断插件管理。 */
export function parsePluginsFile(raw: unknown): PluginsFile {
  if (typeof raw !== 'object' || raw === null) return emptyPluginsFile();
  const value = raw as Record<string, unknown>;
  if (value.version !== PLUGIN_FILE_VERSION) return emptyPluginsFile();
  return { version: PLUGIN_FILE_VERSION, disabled: asStringArray(value.disabled) };
}