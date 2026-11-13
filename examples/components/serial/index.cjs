const fs = require('node:fs');

/**
 * 串口组件样例：打开设备文件做原始字节读写。
 * 说明：样例不设置波特率（需要平台 ioctl），baudRate 字段只做保存；
 * 真串口设备请用 115200 等默认速率，或换成 serialport 实现。
 */
module.exports = {
  id: 'serial',
  kind: 'capability',
  builtin: false,
  apiVersion: '^1.0.0',
  provides: ['session'],
  activation: { onProtocol: 'serial' },

  setup() {
    return {
      exports: {
        openSession(options) {
          const target = options.target || {};
          const devicePath = String(target.path || '');
          if (!devicePath) throw new Error('串口组件缺少设备路径');

          let fd;
          try {
            fd = fs.openSync(devicePath, 'r+');
          } catch (error) {
            throw new Error(`打不开串口设备 ${devicePath}：${error.message}`);
          }

          let closed = false;
          const dataHandlers = new Set();
          const exitHandlers = new Set();

          const emitData = (text) => {
            for (const handler of dataHandlers) handler(text);
          };
          const finish = () => {
            if (closed) return;
            closed = true;
            try {
              fs.closeSync(fd);
            } catch {
              // 设备已拔掉时关闭会报错，忽略即可。
            }
            for (const handler of exitHandlers) handler({ code: 0 });
          };

          // 串口没有 EOF：按块读，没有数据时小睡再读。
          const readLoop = () => {
            if (closed) return;
            const buffer = Buffer.alloc(4096);
            fs.read(fd, buffer, 0, buffer.length, null, (error, bytes) => {
              if (closed) return;
              if (!error && bytes > 0) emitData(buffer.subarray(0, bytes).toString('utf8'));
              setTimeout(readLoop, error || bytes === 0 ? 20 : 1);
            });
          };
          readLoop();

          return {
            session: {
              write(data) {
                if (closed) return;
                try {
                  fs.writeSync(fd, data);
                } catch {
                  // 写失败通常意味着设备断开，退出由 close 兜底。
                }
              },
              resize() {},
              close: finish,
              onData(handler) {
                dataHandlers.add(handler);
                return () => dataHandlers.delete(handler);
              },
              onExit(handler) {
                exitHandlers.add(handler);
                return () => exitHandlers.delete(handler);
              },
            },
          };
        },
      },
      dispose() {},
    };
  },
};
