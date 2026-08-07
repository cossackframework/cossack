export type LinuxOzonePlatform = 'auto' | 'x11' | 'wayland';

export function resolveLinuxOzonePlatform(
  platform: NodeJS.Platform,
  environment: Record<string, string | undefined>,
  configured: LinuxOzonePlatform = 'auto',
): Exclude<LinuxOzonePlatform, 'auto'> | undefined {
  if (platform !== 'linux') return undefined;
  if (configured !== 'auto') return configured;
  const requested = environment.COSSACK_DESKTOP_OZONE_PLATFORM;
  if (requested === 'x11' || requested === 'wayland') return requested;
  if (environment.XDG_SESSION_TYPE === 'wayland' && environment.DISPLAY) return 'x11';
  return undefined;
}
