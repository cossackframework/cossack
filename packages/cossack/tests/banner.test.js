import { describe, expect, it } from 'vitest';
import { colorsEnabled, renderBanner, resizeBanner } from '../src/banner.js';

describe('CLI banner', () => {
  it('renders a compact version of the source artwork', () => {
    const lines = resizeBanner();

    expect(lines).toHaveLength(16);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(52);
    expect(lines.join('\n')).toContain('#');
  });

  it('adapts to narrow terminals', () => {
    const banner = renderBanner({ color: false, columns: 32 });
    const lines = banner.split('\n');

    expect(lines).toHaveLength(9);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(32);
  });

  it('keeps the artwork left-aligned in wide terminals', () => {
    const wide = renderBanner({ color: false, columns: 120 });

    expect(wide).toBe(resizeBanner().join('\n'));
  });

  it('uses a true-color orange gradient when color is enabled', () => {
    const banner = renderBanner({ color: true, columns: 52 });

    expect(banner).toContain('\u001b[38;2;255;181;74m');
    expect(banner).toContain('\u001b[38;2;255;90;0m');
    expect(banner).toContain('\u001b[0m');
  });

  it('respects standard terminal color controls', () => {
    const tty = { isTTY: true };

    expect(colorsEnabled(tty, { TERM: 'xterm-256color' })).toBe(true);
    expect(colorsEnabled(tty, { NO_COLOR: '' })).toBe(false);
    expect(colorsEnabled(tty, { FORCE_COLOR: '0' })).toBe(false);
    expect(colorsEnabled({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true);
  });
});
