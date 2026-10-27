import { Cossack, Page } from '@cossackframework/core';

/**
 * The web app manifest: the site's name and its app icon from Settings → General, resized
 * to the home screen sizes when it is a library image. Without an app icon, the
 * application's own icons from `public/` serve.
 */
@Page({ transport: 'http' })
export default class Manifest extends Cossack {
    async get() {
        const cms = this.c.get('cms');
        let name = 'Site';
        let icon = '';
        try {
            const settings = await cms.settings.all();
            name = settings['general.siteTitle'];
            icon = settings['general.appIcon'];
        } catch { /* before setup: the defaults */ }
        const resizable = icon.startsWith('/media/') && (cms.files?.resizes ?? false);
        const icons = !icon ? [
            { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ] : resizable ? [192, 512].map(size => ({ src: `${icon}?w=${size}&h=${size}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' }))
            : [{ src: icon, sizes: 'any', purpose: 'any maskable' }];
        const manifest = { name, short_name: name.slice(0, 30), start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#ffffff', icons };
        return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' } });
    }
}
