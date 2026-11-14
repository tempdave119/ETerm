import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const telnet = require('../../examples/components/telnet/protocol.cjs') as {
  IAC: number;
  DONT: number;
  DO: number;
  WONT: number;
  WILL: number;
  SB: number;
  SE: number;
  OPTION: Record<'ECHO' | 'SGA' | 'TTYPE' | 'NAWS', number>;
  TERMINAL_TYPE: string;
  encodeUserData(text: string): Buffer;
  createTelnetProtocol(options?: {
    getSize?: () => { cols: number; rows: number };
    onData?: (data: Buffer) => void;
    onReply?: (data: Buffer) => void;
  }): {
    initial(): Buffer;
    push(chunk: Buffer): void;
    resize(cols: number, rows: number): Buffer | null;
    readonly nawsEnabled: boolean;
  };
};

function createProbe(size = { cols: 100, rows: 40 }) {
  const data: Buffer[] = [];
  const replies: Buffer[] = [];
  const protocol = telnet.createTelnetProtocol({
    getSize: () => size,
    onData: (chunk) => data.push(chunk),
    onReply: (chunk) => replies.push(chunk),
  });
  return { protocol, data, replies };
}

test('telnet_protocol_strips_iac_and_keeps_escaped_data', () => {
  const { protocol, data } = createProbe();
  protocol.push(Buffer.from([0x61, telnet.IAC, telnet.IAC, 0x62]));

  assert.deepEqual([...Buffer.concat(data)], [0x61, telnet.IAC, 0x62]);
});

test('telnet_protocol_survives_oversized_subnegotiation', () => {
  const { protocol, data } = createProbe();
  protocol.push(Buffer.from([telnet.IAC, telnet.SB]));
  protocol.push(Buffer.alloc(10_000, 0x41));
  protocol.push(Buffer.from([telnet.IAC, telnet.SE]));
  protocol.push(Buffer.from('ok'));

  // 超长子协商被丢弃，且状态机能回到数据态继续透传。
  assert.equal(Buffer.concat(data).toString(), 'ok');
});

test('telnet_protocol_answers_naws_and_resizes', () => {
  const { protocol, replies } = createProbe();
  protocol.push(Buffer.from([telnet.IAC, telnet.DO, telnet.OPTION.NAWS]));

  assert.equal(protocol.nawsEnabled, true);
  assert.deepEqual(
    [...Buffer.concat(replies)],
    [
      telnet.IAC,
      telnet.WILL,
      telnet.OPTION.NAWS,
      telnet.IAC,
      telnet.SB,
      telnet.OPTION.NAWS,
      0,
      100,
      0,
      40,
      telnet.IAC,
      telnet.SE,
    ],
  );

  const frame = protocol.resize(120, 50);
  assert.ok(frame);
  assert.deepEqual(
    [...frame],
    [telnet.IAC, telnet.SB, telnet.OPTION.NAWS, 0, 120, 0, 50, telnet.IAC, telnet.SE],
  );
});

test('telnet_protocol_answers_ttype_send', () => {
  const { protocol, replies } = createProbe();
  protocol.push(Buffer.from([telnet.IAC, telnet.SB, telnet.OPTION.TTYPE, 1, telnet.IAC, telnet.SE]));

  const reply = Buffer.concat(replies);
  assert.deepEqual([...reply.subarray(0, 4)], [telnet.IAC, telnet.SB, telnet.OPTION.TTYPE, 0]);
  assert.ok(reply.includes(Buffer.from(telnet.TERMINAL_TYPE)));
  assert.deepEqual([...reply.subarray(-2)], [telnet.IAC, telnet.SE]);
});

test('telnet_protocol_negotiates_supported_and_rejects_unknown', () => {
  const { protocol, replies } = createProbe();
  protocol.push(Buffer.from([telnet.IAC, telnet.DO, 99]));
  protocol.push(Buffer.from([telnet.IAC, telnet.WILL, telnet.OPTION.ECHO]));
  protocol.push(Buffer.from([telnet.IAC, telnet.WILL, 99]));

  const reply = Buffer.concat(replies);
  assert.deepEqual(
    [...reply],
    [
      telnet.IAC,
      telnet.WONT,
      99,
      telnet.IAC,
      telnet.DO,
      telnet.OPTION.ECHO,
      telnet.IAC,
      telnet.DONT,
      99,
    ],
  );
});

test('telnet_protocol_handles_sequences_split_across_chunks', () => {
  const { protocol, data, replies } = createProbe();
  protocol.push(Buffer.from([telnet.IAC]));
  protocol.push(Buffer.from([telnet.SB, telnet.OPTION.TTYPE, 1, telnet.IAC]));
  protocol.push(Buffer.from([telnet.SE]));

  assert.equal(data.length, 0);
  assert.ok(Buffer.concat(replies).includes(Buffer.from(telnet.TERMINAL_TYPE)));
});

test('telnet_protocol_initial_declares_capabilities', () => {
  const { protocol } = createProbe();
  assert.deepEqual(
    [...protocol.initial()],
    [
      telnet.IAC,
      telnet.WILL,
      telnet.OPTION.TTYPE,
      telnet.IAC,
      telnet.WILL,
      telnet.OPTION.NAWS,
      telnet.IAC,
      telnet.WILL,
      telnet.OPTION.SGA,
    ],
  );
});

test('telnet_protocol_resize_is_null_before_naws', () => {
  const { protocol } = createProbe();
  assert.equal(protocol.resize(80, 24), null);
});

test('telnet_protocol_encodes_cr_as_nvt_crlf', () => {
  assert.equal(telnet.encodeUserData('echo\r').toString(), 'echo\r\n');
  assert.equal(telnet.encodeUserData('a\r\nb').toString(), 'a\r\nb');
});
