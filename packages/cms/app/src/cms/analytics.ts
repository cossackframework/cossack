import type { HeadTag } from '@cossackframework/core';

/**
 * Settings → Analytics: the outside services that count page views. The site adds their scripts
 * and stores nothing, since a count of its own would be a database write per view, past the
 * cache that protects pages.
 */
export interface AnalyticsServices {
    readonly cloudflareToken: string;
    readonly googleMeasurementId: string;
}

export const NO_ANALYTICS: AnalyticsServices = { cloudflareToken: '', googleMeasurementId: '' };

/** These values reach a page's script, so they are checked here as well as when saved. */
const CLOUDFLARE_TOKEN = /^[A-Za-z0-9]{1,80}$/;
const GOOGLE_ID = /^G-[A-Z0-9]{4,20}$/;

/**
 * Google's tag, built in the page so a browser asking not to be tracked never loads it. The client
 * replaces head tags on navigation and this runs again, so it starts once; Google counts the
 * later pages itself from the browser's history.
 */
const googleScript = (id: string) => `if(!window.gtag&&navigator.doNotTrack!=='1'&&!navigator.globalPrivacyControl){window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${id}');var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${id}';document.head.appendChild(s)}`;

/** The head tags of the services a site has named. */
export function analyticsTags(services: AnalyticsServices): HeadTag[] {
    const { cloudflareToken: token, googleMeasurementId: id } = services;
    return [
        ...(CLOUDFLARE_TOKEN.test(token) ? [{ tag: 'script', attributes: { defer: '', src: 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': JSON.stringify({ token }) }, children: '' }] : []),
        ...(GOOGLE_ID.test(id) ? [{ tag: 'script', attributes: { 'data-cms-google-analytics': '' }, children: googleScript(id) }] : []),
    ];
}
