/** The site's name and logo, for the dashboard's sidebar and the sign-in pages. The CMS replaces this module with its General settings. */

export async function siteName(): Promise<string> {
    return config('app.name');
}

export async function siteLogo(): Promise<string> {
    return '/logo.svg';
}
