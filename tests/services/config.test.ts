import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultConfig,
  parseConfigFile,
  parseConfigInput,
} from '../../src/services/config/schema.ts';
import { ConfigStore } from '../../src/services/config/store.ts';

async function createStore() {
  const dir = join(process.cwd(), 'tmp', 'tests', `config-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return { dir, store: new ConfigStore({ baseDir: dir, logger: () => {} }) };
}

test('config_missing_file_returns_defaults', async () => {
  const { store } = await createStore();

  assert.deepEqual(await store.get(), defaultConfig());
});

test('config_save_persists_after_reload', async () => {
  const { dir, store } = await createStore();
  const next = defaultConfig();
  next.terminal.fontSize = 16;
  next.terminal.rightClick = 'menu';
  next.terminal.rightClickCopySelection = true;
  next.ssh.keepaliveInterval = 60;
  next.ssh.keepaliveCountMax = 5;
  next.transfer.concurrency = 3;
  next.ui.density = 'compact';
  next.files.openByDefault = false;

  await store.save(next);
  const reloaded = new ConfigStore({ baseDir: dir, logger: () => {} });

  assert.deepEqual(await reloaded.get(), next);
});

test('config_reset_restores_defaults', async () => {
  const { store } = await createStore();
  const next = defaultConfig();
  next.terminal.fontSize = 18;
  await store.save(next);

  const reset = await store.reset();

  assert.deepEqual(reset, defaultConfig());
  assert.deepEqual(await store.get(), defaultConfig());
});

test('config_broken_file_is_backed_up_and_falls_back', async () => {
  const { dir, store } = await createStore();
  const filePath = join(dir, 'config.json');
  await writeFile(filePath, '{ not json', 'utf8');

  assert.deepEqual(await store.get(), defaultConfig());
  const backups = (await readdir(dir)).filter((name) => name.startsWith('config.json.broken-'));
  assert.equal(backups.length, 1);
});

test('config_file_keeps_valid_fields_when_one_field_is_bad', () => {
  const file = parseConfigFile({
    version: 1,
    config: {
      terminal: { fontSize: 99 },
      transfer: { concurrency: 2 },
      ui: { density: 'wide' },
      files: { openByDefault: false },
    },
  });

  assert.equal(file.config.terminal.fontSize, 13);
  assert.equal(file.config.terminal.rightClick, 'paste');
  assert.equal(file.config.terminal.rightClickCopySelection, false);
  assert.equal(file.config.ssh.keepaliveInterval, 30);
  assert.equal(file.config.ssh.keepaliveCountMax, 3);
  assert.equal(file.config.transfer.concurrency, 2);
  assert.equal(file.config.ui.density, 'comfortable');
  assert.equal(file.config.ui.theme, 'system');
  assert.equal(file.config.ui.monitorProcessSort, 'memory');
  assert.equal(file.config.files.openByDefault, false);
  assert.equal(file.config.terminal.localCommand, '');
  assert.deepEqual(file.config.shortcuts.overrides, {});
});

test('config_file_rejects_unknown_version', () => {
  assert.throws(
    () => parseConfigFile({ version: 2, config: {} }),
    /不支持的配置版本/,
  );
});

test('config_input_rejects_out_of_range_values', () => {
  const base = defaultConfig();

  assert.throws(() => parseConfigInput({ ...base, terminal: { fontSize: 10 } }), /终端字号/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { fontSize: 21 } }), /终端字号/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { fontSize: 13.5 } }), /终端字号/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, rightClick: 'copy' } }), /右键行为/);
  assert.throws(
    () => parseConfigInput({ ...base, terminal: { ...base.terminal, rightClickCopySelection: 'yes' } }),
    /选中时复制/,
  );
  assert.throws(() => parseConfigInput({ ...base, ssh: { keepaliveInterval: 5, keepaliveCountMax: 3 } }), /保活间隔/);
  assert.throws(() => parseConfigInput({ ...base, ssh: { keepaliveInterval: 30, keepaliveCountMax: 9 } }), /保活重试次数/);
  assert.throws(() => parseConfigInput({ ...base, transfer: { concurrency: 0 } }), /传输并发/);
  assert.throws(() => parseConfigInput({ ...base, transfer: { concurrency: 5 } }), /传输并发/);
  assert.throws(() => parseConfigInput({ ...base, ui: { density: 'wide' } }), /界面密度/);
  assert.throws(() => parseConfigInput({ ...base, ui: { density: 'comfortable', theme: 'blue' } }), /外观主题/);
  assert.throws(
    () => parseConfigInput({ ...base, ui: { ...base.ui, monitorProcessSort: 'disk' } }),
    /进程排序/,
  );
  assert.throws(() => parseConfigInput({ ...base, files: { openByDefault: 'yes' } }), /默认展开文件面板/);
  assert.throws(() => parseConfigInput(null), /配置必须是对象/);
});

test('config_input_accepts_valid_full_config', () => {
  const input = {
    terminal: {
      fontSize: 11,
      fontFamily: 'menlo',
      lineHeight: 1.35,
      cursorStyle: 'bar',
      cursorBlink: false,
      scrollback: 5000,
      rightClick: 'menu',
      rightClickCopySelection: true,
      localCommand: 'bash -l',
    },
    ssh: { keepaliveInterval: 120, keepaliveCountMax: 5 },
    transfer: { concurrency: 4 },
    ui: { density: 'compact', theme: 'light', language: 'en-US', monitorProcessSort: 'cpu', onboarded: true },
    files: { openByDefault: false },
    shortcuts: { overrides: { 'files.toggle': { code: 'KeyG', shift: true }, 'panel.monitor': null } },
  };

  assert.deepEqual(parseConfigInput(input), input);
});

test('config_terminal_appearance_defaults_and_fallbacks', () => {
  // 旧文件缺字段或字段非法时逐项回退默认，不影响其余字段。
  const file = parseConfigFile({
    version: 1,
    config: {
      terminal: { fontFamily: 'comic', lineHeight: 3, cursorStyle: 'beam', scrollback: 200 },
    },
  });
  assert.equal(file.config.terminal.fontFamily, 'sf-mono');
  assert.equal(file.config.terminal.lineHeight, 1.2);
  assert.equal(file.config.terminal.cursorStyle, 'block');
  assert.equal(file.config.terminal.cursorBlink, true);
  assert.equal(file.config.terminal.scrollback, 1000);

  const ok = parseConfigFile({
    version: 1,
    config: {
      terminal: {
        fontFamily: 'monaco',
        lineHeight: 1.345,
        cursorStyle: 'underline',
        cursorBlink: false,
        scrollback: 10000,
      },
    },
  });
  assert.equal(ok.config.terminal.fontFamily, 'monaco');
  assert.equal(ok.config.terminal.lineHeight, 1.35);
  assert.equal(ok.config.terminal.cursorStyle, 'underline');
  assert.equal(ok.config.terminal.cursorBlink, false);
  assert.equal(ok.config.terminal.scrollback, 10000);
});

test('config_input_rejects_bad_terminal_appearance', () => {
  const base = defaultConfig();

  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, fontFamily: 'comic' } }), /终端字体/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, lineHeight: 2 } }), /行高/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, lineHeight: '1.2' } }), /行高/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, cursorStyle: 'beam' } }), /光标样式/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, cursorBlink: 'yes' } }), /光标闪烁/);
  assert.throws(() => parseConfigInput({ ...base, terminal: { ...base.terminal, scrollback: 2000 } }), /滚回缓冲/);
});

test('config_local_command_is_trimmed_and_bounded', () => {
  const base = defaultConfig();

  assert.equal(
    parseConfigInput({ ...base, terminal: { ...base.terminal, localCommand: '  bash -l  ' } }).terminal.localCommand,
    'bash -l',
  );
  assert.throws(
    () => parseConfigInput({ ...base, terminal: { ...base.terminal, localCommand: 'x'.repeat(201) } }),
    /启动命令/,
  );
  assert.throws(
    () => parseConfigInput({ ...base, terminal: { ...base.terminal, localCommand: 42 } }),
    /启动命令必须是字符串/,
  );

  const file = parseConfigFile({
    version: 1,
    config: { terminal: { localCommand: 'x'.repeat(201) } },
  });
  assert.equal(file.config.terminal.localCommand, '');
});

test('config_file_keeps_valid_shortcut_overrides_and_drops_broken_ones', () => {
  const file = parseConfigFile({
    version: 1,
    config: {
      shortcuts: {
        overrides: {
          'files.toggle': { code: 'KeyG', shift: true },
          'panel.monitor': null,
          'tab.close': { code: '' },
          'tab.next': { code: 'KeyL', shift: 'yes' },
        },
      },
    },
  });

  assert.deepEqual(file.config.shortcuts.overrides, {
    'files.toggle': { code: 'KeyG', shift: true },
    'panel.monitor': null,
  });
});

test('config_input_rejects_broken_shortcut_overrides', () => {
  const base = defaultConfig();

  assert.throws(
    () => parseConfigInput({ ...base, shortcuts: { overrides: { 'tab.close': { code: '' } } } }),
    /快捷键 tab.close 缺少 code/,
  );
  assert.throws(
    () => parseConfigInput({ ...base, shortcuts: { overrides: { 'tab.close': { code: 'KeyW', shift: 'yes' } } } }),
    /shift 必须是布尔值/,
  );
  assert.throws(() => parseConfigInput({ ...base, shortcuts: { overrides: 'nope' } }), /快捷键配置必须是对象/);
});

test('config_save_writes_versioned_file', async () => {
  const { dir, store } = await createStore();
  await store.save(defaultConfig());

  const raw = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as {
    version: number;
    config: unknown;
  };
  assert.equal(raw.version, 1);
  assert.deepEqual(raw.config, defaultConfig());
});

test('config_persists_monitor_process_sort', async () => {
  const { store } = await createStore();
  const next = defaultConfig();
  next.ui.monitorProcessSort = 'cpu';

  await store.save(next);

  assert.equal((await store.get()).ui.monitorProcessSort, 'cpu');
});

test('config_persists_shortcut_overrides', async () => {
  const { store } = await createStore();
  const next = defaultConfig();
  next.shortcuts.overrides = { 'files.toggle': { code: 'KeyG', shift: true }, 'panel.monitor': null };

  await store.save(next);

  assert.deepEqual((await store.get()).shortcuts.overrides, next.shortcuts.overrides);
});
