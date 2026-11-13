import { clipboard, ipcMain } from 'electron';
import { normalizeError } from '../core/errors.ts';
import { CLIPBOARD_IPC, type IpcResult } from '../shared/ipc.ts';

const MAX_TEXT = 1_000_000;

/** 终端右键与 ⌘C / ⌘V 走白名单通道，渲染层不直接拿 Electron clipboard。 */
export function registerClipboardIpc(): () => void {
  ipcMain.handle(CLIPBOARD_IPC.read, async (): Promise<IpcResult<string>> => ({
    ok: true,
    value: await clipboard.readText(),
  }));

  ipcMain.handle(CLIPBOARD_IPC.write, async (_event, raw): Promise<IpcResult<null>> => {
    try {
      if (typeof raw !== 'string' || raw.length > MAX_TEXT) {
        throw new Error(`剪贴板内容必须是 0–${MAX_TEXT} 字符的字符串`);
      }
      await clipboard.writeText(raw);
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, error: normalizeError(error).toInfo() };
    }
  });

  return () => {
    ipcMain.removeHandler(CLIPBOARD_IPC.read);
    ipcMain.removeHandler(CLIPBOARD_IPC.write);
  };
}
