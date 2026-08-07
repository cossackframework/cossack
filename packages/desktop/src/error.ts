export class DesktopUnavailableError extends Error {
  constructor() {
    super('@cossackframework/desktop can only create applications and shells in the Electron main process.');
    this.name = 'DesktopUnavailableError';
  }
}
