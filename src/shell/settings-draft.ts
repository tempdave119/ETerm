/**
 * 设置草稿：config 走「草稿 → 保存」，layout 仍即时落盘。
 * 草稿整份用于面板内编辑，但只有外观类字段在保存前影响界面；取消回到已保存值。
 */

import type { AppConfig } from '../shared/ipc.ts';

/** 草稿态即时预览的字段：只影响渲染层外观，保存前不落盘。 */
export const PREVIEW_FIELDS = ['terminal.fontSize', 'ui.theme', 'ui.density'] as const;

/**
 * 面板打开期间用于显示的配置：预览字段取草稿值，其余字段保持已保存值。
 * 行为类字段（保活 / 并发 / 快捷键）因此不会在保存前影响运行中的程序。
 */
export function previewConfig(draft: AppConfig, saved: AppConfig): AppConfig {
  return {
    ...saved,
    terminal: { ...saved.terminal, fontSize: draft.terminal.fontSize },
    ui: { ...saved.ui, theme: draft.ui.theme, density: draft.ui.density },
  };
}

/** 配置体量小且结构固定，序列化比较足够，不引入深比较依赖。 */
export function isDirty(draft: AppConfig, saved: AppConfig): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}
