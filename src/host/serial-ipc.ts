import { readdir } from 'node:fs/promises';
import { ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import type { IpcResult, SerialDevice } from '../shared/ipc.ts';
import { SERIAL_IPC } from '../shared/ipc.ts';
import { pickSerialDevices } from './serial-devices.ts';

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: normalizeError(error).toInfo() };
}

/** 串口设备列表：只读 /dev 目录，不打开设备，枚举失败按空列表处理更友好。 */
export function registerSerialIpc(): () => void {
  ipcMain.handle(SERIAL_IPC.list, async (): Promise<IpcResult<SerialDevice[]>> => {
    try {
      const files = await readdir('/dev');
      return { ok: true, value: pickSerialDevices(files) };
    } catch (error) {
      return failure(error);
    }
  });

  return () => {
    ipcMain.removeHandler(SERIAL_IPC.list);
  };
}
