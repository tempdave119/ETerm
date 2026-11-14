/**
 * 轻量 i18n 运行时：主进程与渲染层共用，不引第三方库。
 * 语言来自 config.ui.language（system / zh-CN / en-US），由各自进程在配置变化时 setLocale。
 */

import { enUS } from './en-US.ts';
import { zhCN, type MessageKey } from './zh-CN.ts';

export type Locale = 'zh-CN' | 'en-US';
export type LocalePreference = 'system' | Locale;
export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { 'zh-CN': zhCN, 'en-US': enUS };
const warned = new Set<string>();
let currentLocale: Locale = 'zh-CN';

/** system 偏好按系统语言归一：zh 开头用中文，其余英文。 */
export function normalizeLocale(preference: LocalePreference, systemLocale: string): Locale {
  if (preference === 'zh-CN' || preference === 'en-US') return preference;
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** 取文案；缺 key 回退中文并只告警一次，避免界面出现空白。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const dictionary = DICTIONARIES[currentLocale] as Record<string, string>;
  const fallback = zhCN as Record<string, string>;
  const template = dictionary[key] ?? fallback[key];
  if (template === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] 缺少文案：${key}`);
    }
    return key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 单测用：清空已告警集合。 */
export function resetMissingKeys(): void {
  warned.clear();
}

export function missingKeys(): string[] {
  return [...warned];
}
