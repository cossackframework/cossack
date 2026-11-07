/**
 * Brand icons for `brand` fields: the network a profile URL belongs to, with its Simple Icons
 * artwork (CC0, copied into `brand-icons.ts` by scripts/brand-icons.mjs so the server ships
 * forty icons, not the set), resolved on the server into `RenderedBlock.icons` so a page ships
 * the icons it shows and nothing else. LinkedIn is drawn here, since Simple Icons dropped it.
 */
import {
    siApplepodcasts, siBehance, siBluesky, siBuymeacoffee, siDiscord, siDribbble, siFacebook, siFlickr, siGithub, siGoodreads, siGooglemaps, siInstagram, siKofi, siLetterboxd, siLine, siMastodon,
    siMedium, siMessenger, siPatreon, siPinterest, siReddit, siRss, siSignal, siSnapchat, siSoundcloud, siSpotify, siStrava, siSubstack, siTelegram, siThreads, siTiktok, siTripadvisor, siTumblr,
    siTwitch, siViber, siVimeo, siVk, siWechat, siWhatsapp, siX, siXing, siYelp, siYoutube, siZalo, type BrandArtwork,
} from './brand-icons';
import type { BrandIcon } from '../theme';

type Artwork = Pick<BrandArtwork, 'title' | 'path' | 'hex'>;

const LINKEDIN: Artwork = { title: 'LinkedIn', hex: '0A66C2', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' };

/** Networks by the hosts their profile URLs use; a host matches itself and its subdomains. */
const BRANDS: readonly (readonly [hosts: readonly string[], icon: Artwork])[] = [
    [['facebook.com', 'fb.com', 'fb.me'], siFacebook],
    [['m.me', 'messenger.com'], siMessenger],
    [['x.com', 'twitter.com'], siX],
    [['instagram.com', 'instagr.am'], siInstagram],
    [['linkedin.com', 'lnkd.in'], LINKEDIN],
    [['youtube.com', 'youtu.be'], siYoutube],
    [['tiktok.com'], siTiktok],
    [['github.com'], siGithub],
    [['pinterest.com', 'pinterest.co.uk', 'pinterest.de', 'pinterest.fr', 'pinterest.jp', 'pin.it'], siPinterest],
    [['threads.net', 'threads.com'], siThreads],
    [['bsky.app', 'bsky.social'], siBluesky],
    [['mastodon.social', 'mastodon.online', 'mstdn.social', 'mas.to', 'fosstodon.org', 'hachyderm.io'], siMastodon],
    [['whatsapp.com', 'wa.me'], siWhatsapp],
    [['t.me', 'telegram.me', 'telegram.org'], siTelegram],
    [['signal.me', 'signal.group'], siSignal],
    [['viber.com'], siViber],
    [['zalo.me'], siZalo],
    [['line.me'], siLine],
    [['wechat.com', 'weixin.qq.com'], siWechat],
    [['discord.gg', 'discord.com'], siDiscord],
    [['reddit.com', 'redd.it'], siReddit],
    [['snapchat.com'], siSnapchat],
    [['twitch.tv'], siTwitch],
    [['spotify.com'], siSpotify],
    [['soundcloud.com'], siSoundcloud],
    [['podcasts.apple.com'], siApplepodcasts],
    [['vimeo.com'], siVimeo],
    [['dribbble.com'], siDribbble],
    [['behance.net'], siBehance],
    [['medium.com'], siMedium],
    [['substack.com'], siSubstack],
    [['tumblr.com'], siTumblr],
    [['flickr.com'], siFlickr],
    [['vk.com'], siVk],
    [['xing.com'], siXing],
    [['patreon.com'], siPatreon],
    [['ko-fi.com'], siKofi],
    [['buymeacoffee.com'], siBuymeacoffee],
    [['strava.com'], siStrava],
    [['yelp.com'], siYelp],
    [['tripadvisor.com', 'tripadvisor.co.uk', 'tripadvisor.de', 'tripadvisor.fr', 'tripadvisor.es', 'tripadvisor.it'], siTripadvisor],
    [['goodreads.com'], siGoodreads],
    [['letterboxd.com'], siLetterboxd],
    [['maps.google.com', 'maps.app.goo.gl', 'g.page'], siGooglemaps],
];

/**
 * The network a URL belongs to, by its host, with the brand's icon: null for a URL of no known
 * network, a `mailto:` or `tel:` link, or anything that is not a URL. A feed (`/feed`, `/rss`,
 * `.xml`) is RSS whatever its host. Themes draw the unknown ones with the site's `link` icon.
 */
export function brandIcon(url: string): BrandIcon | null {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    for (const [hosts, icon] of BRANDS) {
        if (hosts.some(known => host === known || host.endsWith(`.${known}`))) return view(icon);
    }
    if (host.includes('mastodon')) return view(siMastodon);
    if (/(?:\/feed\/?|\/rss\/?|\.xml|\.rss|\.atom)$/i.test(parsed.pathname)) return view(siRss);
    return null;
}

function view(icon: Artwork): BrandIcon {
    return { title: icon.title, path: icon.path, hex: icon.hex };
}
