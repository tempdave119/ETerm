const fs = require('node:fs');
const { SerialPort } = require('serialport');

/**
 * 串口组件：用 serialport 打开设备，参数来自 manifest 字段。
 * 终端发的是 CR，按「回车发送」把它换成设备要求的 CR / LF / CRLF。
 */
const LINE_ENDINGS = { cr: '\r', lf: '\n', crlf: '\r\n' };

function lineEndingOf(value) {
  return LINE_ENDINGS[String(value || 'crlf').toLowerCase()] || '\r\n';
}

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

          // serialport 的打开是异步的，先用同步探测挡住「路径错 / 没权限」这类常见错误，
          // 让上层能拿到明确的失败原因；被占用等运行期错误走 exit。
          try {
            fs.accessSync(devicePath, fs.constants.R_OK | fs.constants.W_OK);
          } catch {
            throw new Error(`打不开串口设备 ${devicePath}：设备不存在或没有读写权限`);
          }

          const flow = String(target.flowControl || 'none');
          const ending = lineEndingOf(target.lineEnding);
          const port = new SerialPort({
            path: devicePath,
            baudRate: Number(target.baudRate || 115200),
            dataBits: Number(target.dataBits || 8),
            stopBits: Number(target.stopBits || 1),
            parity: String(target.parity || 'none'),
            rtscts: flow === 'rtscts',
            xon: flow === 'xonxoff',
            xoff: flow === 'xonxoff',
            autoOpen: false,
          });

          let closed = false;
          let opened = false;
          const dataHandlers = new Set();
          const exitHandlers = new Set();

          const emitExit = (code) => {
            if (closed) return;
            closed = true;
            for (const handler of exitHandlers) handler({ code });
          };

          port.on('data', (buffer) => {
            if (closed) return;
            const text = buffer.toString('utf8');
            for (const handler of dataHandlers) handler(text);
          });
          port.on('close', () => emitExit(0));
          port.on('error', () => emitExit(1));

          port.open((error) => {
            if (error) {
              emitExit(1);
              return;
            }
            opened = true;
            // DTR / RTS 只在打开时设置：Arduino 这类设备靠打开瞬间的 DTR 拉低复位。
            port.set({ dtr: target.dtr !== 'false', rts: target.rts !== 'false' }, () => {});
          });

          const session = {
            write: (data) => {
              if (closed || !opened) return;
              port.write(String(data).replace(/\r/g, ending));
            },
            // 串口没有终端尺寸概念，保留空实现以对齐会话端口。
            resize: () => {},
            close: () => {
              if (closed) return;
              closed = true;
              try {
                port.close();
              } catch {
                // 设备已拔掉时关闭会报错，忽略。
              }
            },
            onData: (handler) => {
              dataHandlers.add(handler);
              return () => dataHandlers.delete(handler);
            },
            onExit: (handler) => {
              exitHandlers.add(handler);
              return () => exitHandlers.delete(handler);
            },
          };

          return { session };
        },
      },
      dispose() {
        // 会话由 SessionService 统一释放；组件本身不持有全局资源。
      },
    };
  },
};
