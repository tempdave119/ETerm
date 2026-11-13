import { chmodSync, existsSync } from 'node:fs';
import path from 'node:path';

// node-pty 1.1.0 的 macOS prebuild 以 644 发布，缺少执行位会让 PTY 启动报 posix_spawnp failed。
// 这里只补权限；原生模块本身是 N-API 预编译，不需要按 Electron ABI 重建。
const helper = path.join(
  'node_modules',
  'node-pty',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'spawn-helper',
);

if (existsSync(helper)) {
  chmodSync(helper, 0o755);
} else {
  console.warn(`[postinstall] 未找到 node-pty spawn-helper：${helper}`);
}
