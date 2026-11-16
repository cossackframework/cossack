import { describe, expect, it } from 'vitest';
import { EMBED_URL } from '@cossackframework/cms';
import { embedUrl } from '../src/cms/site-view';

describe('embeds', () => {
    it('maps provider pages to their players and cards', () => {
        expect(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', title: 'YouTube video', aspect: 'video' });
        expect(embedUrl('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
        expect(embedUrl('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871');
        expect(embedUrl('https://x.com/cossack/status/1234567890123456789')).toMatchObject({ src: 'https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789&dnt=true', aspect: 'tall' });
        expect(embedUrl('https://twitter.com/cossack/status/1234567890123456789?s=20')?.aspect).toBe('tall');
        expect(embedUrl('https://www.instagram.com/p/CxyzAbc123/')?.src).toBe('https://www.instagram.com/p/CxyzAbc123/embed/');
        expect(embedUrl('https://www.tiktok.com/@scout2015/video/6718335390845095173')?.src).toBe('https://www.tiktok.com/embed/v2/6718335390845095173');
        expect(embedUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toMatchObject({ src: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', aspect: 'short' });
        expect(embedUrl('https://open.spotify.com/intl-de/album/4uLU6hMCjMI75M1A2tKUQC')?.aspect).toBe('wide');
        expect(embedUrl('https://soundcloud.com/forss/flickermood')?.src).toContain('w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood');
        expect(embedUrl('https://codepen.io/team/pen/ExYzAbc')?.src).toBe('https://codepen.io/team/embed/ExYzAbc?default-tab=result');
        expect(embedUrl('https://www.figma.com/design/AbCdEfGhIjKlMnOp/Site?node-id=1-2')?.src).toContain('figma.com/embed?embed_host=cossack&url=');
        expect(embedUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.src).toBe('https://www.loom.com/embed/0123456789abcdef0123456789abcdef');
    });

    it('refuses other addresses, as the block\'s field does', () => {
        for (const url of ['https://evil.example/embed', 'javascript:alert(1)', 'http://www.youtube.com/watch?v=dQw4w9WgXcQ']) {
            expect(embedUrl(url)).toBeNull();
            expect(EMBED_URL.test(url)).toBe(false);
        }
        // A provider's page that is not a post, video or track: the field takes the host, the page shows nothing.
        expect(EMBED_URL.test('https://x.com/cossack')).toBe(true);
        expect(embedUrl('https://x.com/cossack')).toBeNull();
        expect(EMBED_URL.test('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toBe(true);
    });
});
