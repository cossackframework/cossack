import {
  app as electronApp,
  configureDesktopClose,
  createDesktopApp,
  createDesktopTray,
  electronRuntimeAdapter,
  Menu,
  nativeImage,
  Notification,
  Tray,
  type DesktopCloseBehavior,
  type DesktopCloseController,
  type MenuItemConstructorOptions,
} from '@cossackframework/desktop';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App';
import { template } from '../root';

export const env: Record<string, unknown> = { ...process.env };
export const frameworkApp = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: electronRuntimeAdapter,
});

const icon = fileURLToPath(new URL('../../desktop-assets/icon-256.png', import.meta.url));
async function main() {
  const desktop = await createDesktopApp({
    identifier: 'dev.cossack.counter',
    productName: 'Cossack Counter',
    assetsRoot: fileURLToPath(new URL('../client/', import.meta.url)),
    env,
    fetch: (request, requestEnv) => frameworkApp.fetch(request, requestEnv),
    window: { title: 'Cossack Counter', icon },
  });

  const window = desktop.mainWindow;
  let tray: Tray | undefined;
  let closeController: DesktopCloseController | undefined;

  const showWindow = () => desktop.show();
  const hideWindow = () => {
    if (tray && !tray.isDestroyed()) desktop.hide();
  };
  const invokeCounterAction = (action: 'increment' | 'decrement') => {
    void window.webContents
      .executeJavaScript(
        `(() => {
      const button = document.querySelector('[data-counter-action="${action}"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`,
        true,
      )
      .then(async (invoked) => {
        if (invoked === false)
          await desktop.shell.dialog.showMessageBox(window, {
            type: 'warning',
            message: 'The counter is still loading. Please try again.',
          });
      })
      .catch((error) => console.warn(`Could not ${action} from the native menu.`, error));
  };

  const notify = () => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Cossack Counter',
      body: 'Native notifications are working.',
    });
    notification.on('click', showWindow);
    notification.show();
  };
  const quit = () => {
    if (closeController) closeController.quit();
    else desktop.quit();
  };
  const label = (value: string) => (process.platform === 'darwin' ? value : `&${value}`);
  const counterActions: MenuItemConstructorOptions[] = [
    { label: label('Increment count'), click: () => invokeCounterAction('increment') },
    { label: label('Decrement count'), click: () => invokeCounterAction('decrement') },
  ];
  const windowActions = (includeHide: boolean): MenuItemConstructorOptions[] => [
    ...counterActions,
    { type: 'separator' },
    { label: label('Show window'), click: showWindow },
    ...(includeHide ? [{ label: label('Hide window'), click: hideWindow }] : []),
    { label: label('Send notification'), click: notify },
    { type: 'separator' },
    { label: label('Quit'), accelerator: 'CmdOrCtrl+Q', click: quit },
  ];

  const supportsReliableTray = process.platform === 'darwin' || process.platform === 'win32';
  if (supportsReliableTray) {
    try {
      const trayAsset = process.platform === 'darwin'
        ? '../../desktop-assets/tray-macosTemplate.png'
        : '../../desktop-assets/tray-windows-32.png';
      const trayImage = nativeImage.createFromPath(fileURLToPath(new URL(trayAsset, import.meta.url)));
      if (!trayImage.isEmpty()) {
        if (process.platform === 'darwin') trayImage.setTemplateImage(true);
        tray = createDesktopTray({
          image: trayImage,
          toolTip: 'Cossack Counter',
          menu: Menu.buildFromTemplate(windowActions(true)),
        });
        tray.on('click', showWindow);
      }
    } catch (error) {
      console.warn('Tray creation failed; close-to-tray is disabled.', error);
    }
  }

  const actions = windowActions(Boolean(tray));
  tray?.setContextMenu(Menu.buildFromTemplate(actions));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { label: label('Counter'), submenu: actions },
      { role: 'viewMenu' },
    ]),
  );
  window.webContents.on('context-menu', () => {
    Menu.buildFromTemplate(actions).popup({ window });
  });

  let closeBehavior: DesktopCloseBehavior;
  switch (process.platform) {
    case 'darwin':
    case 'win32':
      closeBehavior = tray ? 'hide-to-tray' : 'quit';
      break;
    case 'linux':
      closeBehavior = 'confirm-quit';
      break;
    default:
      closeBehavior = 'quit';
  }
  closeController = configureDesktopClose({
    window,
    behavior: closeBehavior,
    tray,
    confirmation: {
      title: 'Cossack Counter',
      message: 'Quit Cossack Counter?',
      detail: 'Your counter value is saved automatically.',
    },
    onQuit: () => {
      tray?.destroy();
      desktop.quit();
    },
  });

  if (electronApp.dock) electronApp.dock.setMenu(Menu.buildFromTemplate(actions));
  if (process.platform === 'win32') {
    window.setThumbarButtons([
      {
        tooltip: 'Decrement count',
        icon: nativeImage.createFromPath(icon),
        click: () => invokeCounterAction('decrement'),
      },
      {
        tooltip: 'Increment count',
        icon: nativeImage.createFromPath(icon),
        click: () => invokeCounterAction('increment'),
      },
    ]);
  }

  if (process.env.COSSACK_DESKTOP_SMOKE === '1') {
    window.webContents.once('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`Desktop smoke load failed (${code}) for ${url}: ${description}`);
      electronApp.exit(1);
    });
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once('did-finish-load', () => desktop.quit());
    } else {
      desktop.quit();
    }
  }
}

void main().catch((error) => {
  console.error('Cossack Desktop failed to start.', error);
  electronApp.exit(1);
});
