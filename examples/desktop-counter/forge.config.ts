import path from 'node:path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerWix } from '@electron-forge/maker-wix';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    prune: false,
    ignore: [/^\/node_modules(?:\/|$)/, /^\/src(?:\/|$)/, /^\/public(?:\/|$)/],
    name: 'Cossack Counter',
    executableName: 'cossack-counter',
    appBundleId: 'dev.cossack.counter',
    appCategoryType: 'public.app-category.developer-tools',
    icon: process.platform === 'darwin'
      ? 'desktop-assets/icon.icns'
      : process.platform === 'win32'
        ? 'desktop-assets/icon.ico'
        : 'desktop-assets/icon-512.png',
    ...(process.env.APPLE_IDENTITY ? { osxSign: { identity: process.env.APPLE_IDENTITY } } : {}),
    ...(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID ? {
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      },
    } : {}),
  },
  makers: [
    new MakerDeb({ options: {
      name: 'cossack-counter', productName: 'Cossack Counter', genericName: 'Cossack Counter',
      description: 'Cossack Framework Electron Desktop counter example',
      bin: 'cossack-counter',
      maintainer: 'Cossack Framework <maintainers@cossack.dev>',
      homepage: 'https://cossack.dev',
      desktopTemplate: path.resolve('desktop-assets/linux.desktop.ejs'),
      icon: 'desktop-assets/icon-512.png', categories: ['Utility'], section: 'utils',
    } }),
    new MakerWix({
      name: 'Cossack Counter', manufacturer: 'Cossack Framework',
      appUserModelId: 'dev.cossack.counter', icon: 'desktop-assets/icon.ico',
      exe: 'cossack-counter.exe',
    }),
    new MakerDMG({ name: 'Cossack Counter', format: 'ULFO' }),
  ],
};

export default config;
