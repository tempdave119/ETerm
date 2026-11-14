import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { PluginStore } from '../services/plugins/store.ts';
import { resolvePluginAsset } from '../shared/plugins.ts';

export const PLUGIN_SCHEME = 'eterm-plugin';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
};

/** 自定义协议必须先注册特权，且只能在 app ready 之前调用一次。 */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/**
 * 插件面板通过 iframe 加载 `eterm-plugin://<pluginId>/panel.html`。
 * 只服务启用插件的目录内文件；路径穿越与非法 id 一律拒绝。
 */
export function registerPluginProtocol(store: PluginStore): () => void {
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const root = await store.panelRoot(url.hostname);
      if (!root) return new Response('not found', { status: 404 });

      const target = resolvePluginAsset(root, decodeURIComponent(url.pathname));
      if (!target) return new Response('forbidden', { status: 403 });

      const data = await readFile(target);
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  return () => protocol.unhandle(PLUGIN_SCHEME);
}