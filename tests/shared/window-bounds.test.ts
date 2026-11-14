import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWindowBounds, fitWindowBounds, type WindowRect } from '../../src/shared/window-bounds.ts';

const primary: WindowRect = { x: 0, y: 0, width: 1920, height: 1080 };
const external: WindowRect = { x: 1920, y: 0, width: 2560, height: 1440 };

test('window_bounds_defaults_to_1080x720_centered', () => {
  assert.deepEqual(defaultWindowBounds(primary), {
    x: 420,
    y: 180,
    width: 1080,
    height: 720,
  });
});

test('window_bounds_shrinks_default_on_small_display', () => {
  assert.deepEqual(defaultWindowBounds({ x: 0, y: 0, width: 1024, height: 768 }), {
    x: 0,
    y: 24,
    width: 1024,
    height: 720,
  });
});

test('window_bounds_keeps_saved_position_on_external_display', () => {
  const saved = { x: 2100, y: 120, width: 1200, height: 800 };
  assert.deepEqual(fitWindowBounds(saved, [primary, external], primary), saved);
});

test('window_bounds_clamps_saved_window_inside_display', () => {
  const saved = { x: 1900, y: 1000, width: 1080, height: 720 };
  const fitted = fitWindowBounds(saved, [primary], primary);
  assert.equal(fitted.x, 840);
  assert.equal(fitted.y, 360);
  assert.equal(fitted.width, 1080);
  assert.equal(fitted.height, 720);
});

test('window_bounds_returns_to_fallback_when_saved_display_is_gone', () => {
  const saved = { x: 2400, y: 200, width: 1200, height: 800 };
  assert.deepEqual(fitWindowBounds(saved, [primary], primary), defaultWindowBounds(primary));
});

test('window_bounds_rejects_invalid_or_too_small_saved_bounds', () => {
  assert.deepEqual(
    fitWindowBounds({ x: 10, y: 10, width: 600, height: 400 }, [primary], primary),
    defaultWindowBounds(primary),
  );
  assert.deepEqual(fitWindowBounds(null, [primary], primary), defaultWindowBounds(primary));
});
