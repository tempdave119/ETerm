/**
 * 串口设备枚举：纯函数，输入 /dev 下的文件名列表，输出可选设备。
 * macOS 上主动连接优先用呼出设备 `cu.*`；`tty.*` 只在没有同名 cu 时列为备选。
 */

import type { SerialDevice } from '../shared/ipc.ts';

export function pickSerialDevices(files: readonly string[]): SerialDevice[] {
  const names = files.filter((name) => name.length > 4);
  const cu = names.filter((name) => name.startsWith('cu.'));
  const covered = new Set(cu.map((name) => name.slice('cu.'.length)));
  const tty = names.filter((name) => name.startsWith('tty.') && !covered.has(name.slice('tty.'.length)));

  return [...cu.sort(), ...tty.sort()].map((name) => ({
    path: `/dev/${name}`,
    label: name.replace(/^(cu|tty)\./, ''),
  }));
}
