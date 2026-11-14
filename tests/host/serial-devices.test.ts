import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSerialDevices } from '../../src/host/serial-devices.ts';

test('serial_devices_prefer_cu_and_keep_uncovered_tty', () => {
  const devices = pickSerialDevices([
    'tty.Bluetooth-Incoming-Port',
    'cu.Bluetooth-Incoming-Port',
    'tty.usbserial-1420',
    'cu.usbserial-1420',
    'cu.SLAB_USBtoUART',
    'tty.legacy-only',
    'null',
    'cu.',
  ]);
  assert.deepEqual(devices, [
    { path: '/dev/cu.Bluetooth-Incoming-Port', label: 'Bluetooth-Incoming-Port' },
    { path: '/dev/cu.SLAB_USBtoUART', label: 'SLAB_USBtoUART' },
    { path: '/dev/cu.usbserial-1420', label: 'usbserial-1420' },
    { path: '/dev/tty.legacy-only', label: 'legacy-only' },
  ]);
});

test('serial_devices_returns_empty_for_no_matches', () => {
  assert.deepEqual(pickSerialDevices(['null', 'random', 'cu.']), []);
  assert.deepEqual(pickSerialDevices([]), []);
});
