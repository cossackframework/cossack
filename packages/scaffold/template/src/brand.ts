/** The site's name and logo, for the dashboard's sidebar and the sign-in pages. The CMS replaces this module with its General settings. */

export async function siteName(): Promise<string> {
    return config('app.name');
}

export async function siteLogo(): Promise<string> {
    return '/logo.svg';
}

/** Who the sign-in pages sign in to. */
export interface SignInBrand {
    name: string;
    logo: string;
    /** Where "Back to Home" goes. */
    home: string;
    /** The network whose account signs the visitor in to another site; empty otherwise. */
    network: string;
    /** On a site of a network: where its members with a network account sign in instead, and the network's name. */
    networkSignIn: { href: string; name: string } | null;
}

export async function signInBrand(): Promise<SignInBrand> {
    return { name: await siteName(), logo: await siteLogo(), home: '/', network: '', networkSignIn: null };
}
