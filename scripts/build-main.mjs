import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist/main', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // electron 与原生模块必须留给运行时 require，不能打进 bundle。
  external: ['electron', 'node-pty', 'ssh2'],
  sourcemap: true,
  logLevel: 'info',
};

await build({ ...common, entryPoints: ['src/host/main.ts'], outfile: 'dist/main/main.cjs' });
await build({ ...common, entryPoints: ['src/host/preload.ts'], outfile: 'dist/main/preload.cjs' });
