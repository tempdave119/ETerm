'use strict';

/**
 * 最小 Telnet 协议状态机：只处理 IAC 协商、NAWS 窗口尺寸与 TTYPE。
 * 不实现行模式 / 认证 / 加密；服务端下发什么终端数据就原样交给上层。
 */

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

const OPTION = { ECHO: 1, SGA: 3, TTYPE: 24, NAWS: 31 };
const TTYPE_IS = 0;
const TTYPE_SEND = 1;
const TERMINAL_TYPE = 'xterm-256color';

function command(verb, option) {
  return Buffer.from([IAC, verb, option]);
}

function subnegotiation(option, payload) {
  return Buffer.concat([Buffer.from([IAC, SB, option]), payload, Buffer.from([IAC, SE])]);
}

function nawsFrame(cols, rows) {
  const width = Math.max(2, Math.min(0xffff, Math.floor(cols)));
  const height = Math.max(1, Math.min(0xffff, Math.floor(rows)));
  return subnegotiation(OPTION.NAWS, Buffer.from([width >> 8, width & 0xff, height >> 8, height & 0xff]));
}

/** 回车按 NVT 发 CR LF；0xFF 是 IAC，普通数据里要双写。 */
function encodeUserData(text) {
  const normalized = String(text).replace(/\r(?!\n)/g, '\r\n');
  const bytes = Buffer.from(normalized, 'utf8');
  const output = [];
  for (const byte of bytes) {
    output.push(byte);
    if (byte === IAC) output.push(IAC);
  }
  return Buffer.from(output);
}

function createTelnetProtocol(options = {}) {
  const onData = options.onData ?? (() => {});
  const onReply = options.onReply ?? (() => {});
  const getSize = options.getSize ?? (() => ({ cols: 80, rows: 24 }));

  let state = 'data';
  let negotiationVerb = 0;
  let subnegotiationBytes = [];
  let nawsEnabled = false;

  const reply = (buffer) => {
    if (buffer.length > 0) onReply(buffer);
  };

  const handleSubnegotiation = () => {
    if (subnegotiationBytes.length < 2) return;
    const option = subnegotiationBytes[0];
    const verb = subnegotiationBytes[1];
    if (option === OPTION.TTYPE && verb === TTYPE_SEND) {
      reply(subnegotiation(OPTION.TTYPE, Buffer.concat([Buffer.from([TTYPE_IS]), Buffer.from(TERMINAL_TYPE)])));
    }
  };

  const handleNegotiation = (verb, option) => {
    if (verb === DO) {
      if (option === OPTION.NAWS) {
        nawsEnabled = true;
        const { cols, rows } = getSize();
        reply(Buffer.concat([command(WILL, option), nawsFrame(cols, rows)]));
        return;
      }
      reply(command(option === OPTION.TTYPE || option === OPTION.SGA ? WILL : WONT, option));
      return;
    }

    if (verb === WILL) {
      reply(command(option === OPTION.ECHO || option === OPTION.SGA ? DO : DONT, option));
      return;
    }

    if (verb === DONT && option === OPTION.NAWS) {
      nawsEnabled = false;
    }
    // WONT / DONT 不再回包，避免协商互相触发形成循环。
  };

  return {
    /** 连接后主动声明能力；NAWS 等服务端 DO 后再发尺寸。 */
    initial() {
      return Buffer.concat([
        command(WILL, OPTION.TTYPE),
        command(WILL, OPTION.NAWS),
        command(WILL, OPTION.SGA),
      ]);
    },

    push(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const data = [];

      for (const byte of buffer) {
        switch (state) {
          case 'data':
            if (byte === IAC) state = 'iac';
            else data.push(byte);
            break;

          case 'iac':
            if (byte === IAC) {
              data.push(byte);
              state = 'data';
            } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
              negotiationVerb = byte;
              state = 'negotiation';
            } else if (byte === SB) {
              subnegotiationBytes = [];
              state = 'sb';
            } else {
              state = 'data';
            }
            break;

          case 'negotiation':
            handleNegotiation(negotiationVerb, byte);
            state = 'data';
            break;

          case 'sb':
            if (byte === IAC) state = 'sb-iac';
            else subnegotiationBytes.push(byte);
            break;

          case 'sb-iac':
            if (byte === SE) {
              handleSubnegotiation();
              state = 'data';
            } else if (byte === IAC) {
              subnegotiationBytes.push(IAC);
              state = 'sb';
            } else {
              state = 'sb';
            }
            break;
        }
      }

      if (data.length > 0) onData(Buffer.from(data));
    },

    /** 未协商 NAWS 时返回 null；协商后返回要写给服务端的窗口尺寸帧。 */
    resize(cols, rows) {
      return nawsEnabled ? nawsFrame(cols, rows) : null;
    },

    get nawsEnabled() {
      return nawsEnabled;
    },
  };
}

module.exports = {
  IAC,
  DONT,
  DO,
  WONT,
  WILL,
  SB,
  SE,
  OPTION,
  TERMINAL_TYPE,
  command,
  subnegotiation,
  nawsFrame,
  encodeUserData,
  createTelnetProtocol,
};
