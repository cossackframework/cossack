import { describe, expect, it } from 'vitest';
import {
  developmentGraphicsArgs,
  developmentSandboxArgs,
  isSuccessfulBuildOutput,
} from '../src/dev-signals';
import { resolveLinuxOzonePlatform } from '../src/platform';

describe('Desktop development runner signals', () => {
  it('recognizes initial and watched Vite build completion', () => {
    expect(isSuccessfulBuildOutput('✓ built in 231ms')).toBe(true);
    expect(isSuccessfulBuildOutput('built in 1.4s')).toBe(true);
    expect(isSuccessfulBuildOutput('watching for file changes...')).toBe(false);
    expect(isSuccessfulBuildOutput('transforming modules')).toBe(false);
  });

  it('only disables Chromium sandboxing for a misconfigured Linux development helper', () => {
    expect(developmentSandboxArgs('linux', { uid: 0, mode: 0o104755 })).toEqual([]);
    expect(developmentSandboxArgs('linux', { uid: 1000, mode: 0o100755 })).toEqual(['--no-sandbox']);
    expect(developmentSandboxArgs('linux', undefined)).toEqual(['--no-sandbox']);
    expect(developmentSandboxArgs('darwin', undefined)).toEqual([]);
    expect(developmentSandboxArgs('win32', undefined)).toEqual([]);
  });

  it('uses XWayland for incompatible Wayland/Vulkan development sessions', () => {
    expect(developmentGraphicsArgs('linux', {
      XDG_SESSION_TYPE: 'wayland',
      DISPLAY: ':0',
    })).toEqual(['--ozone-platform=x11', '--log-level=3']);
    expect(developmentGraphicsArgs('linux', {
      XDG_SESSION_TYPE: 'wayland',
      DISPLAY: ':0',
      COSSACK_DESKTOP_OZONE_PLATFORM: 'wayland',
      COSSACK_DESKTOP_DEBUG: '1',
    })).toEqual(['--ozone-platform=wayland']);
    expect(developmentGraphicsArgs('linux', {
      XDG_SESSION_TYPE: 'wayland',
    })).toEqual(['--log-level=3']);
    expect(developmentGraphicsArgs('darwin', {})).toEqual([]);
  });

  it('selects an overridable packaged Linux display backend', () => {
    expect(resolveLinuxOzonePlatform('linux', {
      XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0',
    })).toBe('x11');
    expect(resolveLinuxOzonePlatform('linux', {
      XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0', COSSACK_DESKTOP_OZONE_PLATFORM: 'wayland',
    })).toBe('wayland');
    expect(resolveLinuxOzonePlatform('linux', {}, 'wayland')).toBe('wayland');
    expect(resolveLinuxOzonePlatform('linux', {})).toBeUndefined();
    expect(resolveLinuxOzonePlatform('darwin', {}, 'x11')).toBeUndefined();
  });
});
