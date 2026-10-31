/** The site's name and logo, from Settings → General, for the dashboard's sidebar and the sign-in pages. Replaces the scaffold's module. */
import { currentCms } from './cms/index';

export async function siteName(): Promise<string> {
    try { return await currentCms().settings.get('general.siteTitle'); }
    catch { return config('app.name'); }
}

/** The logo of Settings → General; the bundled one until it is set. */
export async function siteLogo(): Promise<string> {
    try { return await currentCms().settings.get('general.logo') || '/logo.svg'; }
    catch { return '/logo.svg'; }
}
