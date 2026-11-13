import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import electronPath from 'electron';

const VITE_URL = 'http://127.0.0.1:5173';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`))));
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务器还没起来，继续等。
    }
    await delay(200);
  }
  throw new Error(`等待 Vite 超时：${url}`);
}

await run(process.execPath, ['scripts/build-main.mjs']);

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], {
  stdio: 'inherit',
});
let app = null;

function shutdown(code) {
  app?.kill();
  vite.kill();
  process.exit(code);
}

try {
  await waitForServer(VITE_URL, 20_000);
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

app = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ETERM_DEV_SERVER_URL: VITE_URL },
});
app.on('exit', (code) => shutdown(code ?? 0));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
