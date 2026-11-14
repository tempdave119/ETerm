import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThemeStore } from '../../src/services/themes/store.ts';
import { isThemeColor, parseThemeDefinition } from '../../src/shared/theme.ts';

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'eterm-themes-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const validTheme = {
  id: 'nord',
  name: 'Nord',
  base: 'dark',
  ui: { '--bg-canvas': '#101820', '--text-primary': '#e5e9f0' },
  terminal: { background: '#101820', foreground: '#e5e9f0' },
};

test('themes_store_loads_valid_theme', async () => {
  await withTempDir(async (directory) => {
    const logs: string[] = [];
    const store = new ThemeStore({ baseDir: directory, logger: (message) => logs.push(message) });
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(join(directory, 'themes', 'nord.json'), JSON.stringify(validTheme), 'utf8');

    const themes = await store.list();
    assert.equal(themes.length, 1);
    assert.equal(themes[0]?.id, 'nord');
    assert.equal(themes[0]?.base, 'dark');
    assert.equal(themes[0]?.ui['--bg-canvas'], '#101820');
    assert.equal(themes[0]?.terminal.background, '#101820');
    assert.deepEqual(logs, []);
  });
});

test('themes_store_skips_bad_files_and_keeps_valid_ones', async () => {
  await withTempDir(async (directory) => {
    const logs: string[] = [];
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(join(directory, 'themes', 'good.json'), JSON.stringify(validTheme), 'utf8');
    await writeFile(join(directory, 'themes', 'broken.json'), '{ not-json', 'utf8');
    await writeFile(
      join(directory, 'themes', 'unknown.json'),
      JSON.stringify({ ...validTheme, id: 'unknown', ui: { '--font-body': '13px' } }),
      'utf8',
    );

    const store = new ThemeStore({ baseDir: directory, logger: (message) => logs.push(message) });
    const themes = await store.list();
    assert.equal(themes.length, 1);
    assert.equal(themes[0]?.id, 'nord');
    assert.equal(logs.length, 2);
    assert.ok(logs.some((line) => line.includes('broken.json')));
    assert.ok(logs.some((line) => line.includes('unknown.json')));
  });
});

test('themes_store_keeps_first_duplicate_id', async () => {
  await withTempDir(async (directory) => {
    const logs: string[] = [];
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(join(directory, 'themes', 'a.json'), JSON.stringify(validTheme), 'utf8');
    await writeFile(
      join(directory, 'themes', 'b.json'),
      JSON.stringify({ ...validTheme, name: 'Second Nord' }),
      'utf8',
    );

    const store = new ThemeStore({ baseDir: directory, logger: (message) => logs.push(message) });
    const themes = await store.list();
    assert.equal(themes.length, 1);
    assert.equal(themes[0]?.name, 'Nord');
    assert.ok(logs.some((line) => line.includes('b.json')));
  });
});

test('themes_store_rejects_reserved_id', async () => {
  await withTempDir(async (directory) => {
    const logs: string[] = [];
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(
      join(directory, 'themes', 'dark.json'),
      JSON.stringify({ ...validTheme, id: 'dark' }),
      'utf8',
    );

    const store = new ThemeStore({ baseDir: directory, logger: (message) => logs.push(message) });
    assert.deepEqual(await store.list(), []);
    assert.equal(logs.length, 1);
  });
});

test('themes_store_merges_plugin_themes', async () => {
  await withTempDir(async (directory) => {
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(join(directory, 'themes', 'nord.json'), JSON.stringify(validTheme), 'utf8');
    const pluginDir = join(directory, 'plugins', 'demo');
    await mkdir(join(pluginDir, 'themes'), { recursive: true });
    await writeFile(
      join(pluginDir, 'themes', 'ocean.json'),
      JSON.stringify({ ...validTheme, id: 'plugin-ocean', name: 'Plugin Ocean' }),
      'utf8',
    );

    const store = new ThemeStore({
      baseDir: directory,
      logger: () => {},
      pluginThemeDirs: async () => [{ pluginId: 'demo', directory: pluginDir }],
    });
    const themes = await store.list();

    assert.deepEqual(themes.map((theme) => theme.id).sort(), ['nord', 'plugin-ocean']);
    assert.equal(themes.find((theme) => theme.id === 'plugin-ocean')?.name, 'Plugin Ocean');
  });
});

test('themes_store_plugin_conflict_keeps_external', async () => {
  await withTempDir(async (directory) => {
    await mkdir(join(directory, 'themes'), { recursive: true });
    await writeFile(join(directory, 'themes', 'nord.json'), JSON.stringify(validTheme), 'utf8');
    const pluginDir = join(directory, 'plugins', 'demo');
    await mkdir(join(pluginDir, 'themes'), { recursive: true });
    await writeFile(
      join(pluginDir, 'themes', 'nord.json'),
      JSON.stringify({ ...validTheme, name: 'Plugin Nord' }),
      'utf8',
    );

    const store = new ThemeStore({
      baseDir: directory,
      logger: () => {},
      pluginThemeDirs: async () => [{ pluginId: 'demo', directory: pluginDir }],
    });
    const themes = await store.list();

    assert.equal(themes.length, 1);
    assert.equal(themes[0]?.name, 'Nord');
  });
});

test('themes_store_skips_missing_plugin_theme_dir', async () => {
  await withTempDir(async (directory) => {
    const store = new ThemeStore({
      baseDir: directory,
      logger: () => {},
      pluginThemeDirs: async () => [{ pluginId: 'demo', directory: join(directory, 'plugins', 'demo') }],
    });

    assert.deepEqual(await store.list(), []);
  });
});

test('themes_color_validation_only_accepts_plain_colors', () => {
  assert.equal(isThemeColor('#101820'), true);
  assert.equal(isThemeColor('#abc'), true);
  assert.equal(isThemeColor('rgba(16, 24, 32, 0.5)'), true);
  assert.equal(isThemeColor('rgb(0, 0, 0)'), true);
  assert.equal(isThemeColor('red'), false);
  assert.equal(isThemeColor('var(--bg-canvas)'), false);
  assert.equal(isThemeColor('rgb(300, 0, 0)'), false);
  assert.equal(isThemeColor('rgba(1, 2, 3, 1.5)'), false);
  assert.equal(isThemeColor('#12345; background: red'), false);
});

test('themes_parse_rejects_unknown_terminal_key', () => {
  assert.throws(
    () => parseThemeDefinition({ ...validTheme, terminal: { fontFamily: 'Menlo' } }),
    /未知键/,
  );
});
