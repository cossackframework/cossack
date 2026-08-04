export class DesktopUnavailableError extends Error {
  constructor() {
    super('Deno Desktop APIs are unavailable in this runtime.');
    this.name = 'DesktopUnavailableError';
  }
}
