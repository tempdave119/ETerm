import test from 'node:test';
import assert from 'node:assert/strict';
import type { MenuItemConstructorOptions } from 'electron';
import { buildMenuTemplate, shortcutToAccelerator, type MenuActions } from '../../src/host/menu.ts';
import { resolveShortcuts } from '../../src/shared/shortcut.ts';
import type { MenuCommand } from '../../src/shared/ipc.ts';

function createActions(run: (command: MenuCommand) => void = () => {}): MenuActions & {
  opened: number;
  about: number;
} {
  const state = {
    run,
    opened: 0,
    about: 0,
    openDataDir: () => {
      state.opened += 1;
    },
    showAbout: () => {
      state.about += 1;
    },
  };
  return state;
}

function submenuOf(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const menu = items.find((item) => item.label === label);
  assert.ok(menu, `缺少菜单：${label}`);
  assert.ok(Array.isArray(menu.submenu), `菜单 ${label} 没有子项`);
  return menu.submenu as MenuItemConstructorOptions[];
}

function itemByLabel(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = items.find((entry) => entry.label === label);
  assert.ok(item, `缺少菜单项：${label}`);
  return item;
}

test('menu_accelerator_maps_codes', () => {
  assert.equal(shortcutToAccelerator({ code: 'KeyT' }), 'CommandOrControl+T');
  assert.equal(shortcutToAccelerator({ code: 'KeyD', shift: true }), 'CommandOrControl+Shift+D');
  assert.equal(shortcutToAccelerator({ code: 'Comma' }), 'CommandOrControl+,');
  assert.equal(shortcutToAccelerator({ code: 'BracketLeft', shift: true }), 'CommandOrControl+Shift+[');
  assert.equal(shortcutToAccelerator({ code: 'Backquote' }), 'CommandOrControl+`');
  assert.equal(shortcutToAccelerator({ code: 'F5' }), 'CommandOrControl+F5');
  assert.equal(shortcutToAccelerator({ code: 'UnknownCode' }), undefined);
  assert.equal(shortcutToAccelerator(null), undefined);
});

test('menu_template_has_core_menus_and_items', () => {
  const template = buildMenuTemplate(resolveShortcuts({}), createActions(), 'ETerm');
  const labels = template.map((item) => item.label);
  assert.deepEqual(labels, ['ETerm', '文件', '编辑', '视图', '窗口', '帮助']);

  const file = submenuOf(template, '文件');
  assert.equal(itemByLabel(file, '新建终端').accelerator, 'CommandOrControl+T');
  assert.equal(itemByLabel(file, '新建连接').accelerator, 'CommandOrControl+N');
  assert.equal(itemByLabel(file, '关闭标签').accelerator, 'CommandOrControl+W');

  const view = submenuOf(template, '视图');
  assert.equal(itemByLabel(view, '设置…').accelerator, 'CommandOrControl+,');
  assert.equal(itemByLabel(view, '切换文件面板').accelerator, 'CommandOrControl+Shift+F');
});

test('menu_edit_items_do_not_register_accelerators', () => {
  const template = buildMenuTemplate(resolveShortcuts({}), createActions(), 'ETerm');
  const edit = submenuOf(template, '编辑');
  // 注册 ⌘C / ⌘V 会抢走输入框里的系统复制粘贴，终端复制走 xterm 自己的键盘处理。
  for (const label of ['复制', '粘贴', '全选']) {
    assert.equal(itemByLabel(edit, label).accelerator, undefined, `${label} 不应注册快捷键`);
  }
});

test('menu_accelerator_follows_user_overrides_and_unbind', () => {
  const shortcuts = resolveShortcuts({ 'files.toggle': { code: 'KeyG', shift: true }, 'tab.close': null });
  const template = buildMenuTemplate(shortcuts, createActions(), 'ETerm');
  const view = submenuOf(template, '视图');
  assert.equal(itemByLabel(view, '切换文件面板').accelerator, 'CommandOrControl+Shift+G');

  const file = submenuOf(template, '文件');
  assert.equal(itemByLabel(file, '关闭标签').accelerator, undefined);
});

test('menu_items_dispatch_commands', () => {
  const run: string[] = [];
  const template = buildMenuTemplate(resolveShortcuts({}), createActions((command) => run.push(command)), 'ETerm');
  const file = submenuOf(template, '文件');
  (itemByLabel(file, '新建终端').click as (() => void) | undefined)?.();
  const edit = submenuOf(template, '编辑');
  (itemByLabel(edit, '复制').click as (() => void) | undefined)?.();
  assert.deepEqual(run, ['terminal.new', 'edit.copy']);
});

test('menu_help_items_open_data_dir_and_about', () => {
  const actions = createActions();
  const template = buildMenuTemplate(resolveShortcuts({}), actions, 'ETerm');
  const help = submenuOf(template, '帮助');
  (itemByLabel(help, '打开配置目录').click as (() => void) | undefined)?.();
  (itemByLabel(help, '关于 ETerm').click as (() => void) | undefined)?.();
  assert.equal(actions.opened, 1);
  assert.equal(actions.about, 1);
});
