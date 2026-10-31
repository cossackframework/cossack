/**
 * Site settings, declared as groups of fields. Declarations are data and client-safe; the
 * host stores one row per key and validates writes against these declarations.
 */
import { field, type FieldDeclaration } from './fields';
import { SEO_TEMPLATE_DEFAULTS } from './seo';

/** Choices filled in by the host when a form renders, such as the list of roles. */
/** Where a setting's choices come from; `media` lists the library's images by their URL. */
export type SettingSource = 'roles' | 'pages' | 'categories' | 'timezones' | 'media';

export interface SettingDeclaration extends FieldDeclaration {
    readonly source?: SettingSource;
    /** Labels for enum values. */
    readonly choices?: { readonly [value: string]: string };
}

export interface SettingsGroup {
    /** Lowercase name, such as `general`. Keys are `<group>.<field>`. */
    readonly id: string;
    readonly label: string;
    readonly description?: string;
    readonly fields: { readonly [name: string]: SettingDeclaration };
    /** Permission needed to change the group. Default `cms:settings`; Appearance groups use `cms:appearance`. */
    readonly permission?: string;
    /** Shown as a subpage of this group, such as Crawlers under SEO; keys keep the group's own ID. */
    readonly parent?: string;
}

export const DATE_FORMATS = Object.freeze({ long: 'October 16, 2026', medium: 'Oct 16, 2026', iso: '2026-10-16', us: '10/16/2026', eu: '16/10/2026' });
export const TIME_FORMATS = Object.freeze({ '12h': '3:45 pm', '24h': '15:45' });

/** General and Media settings belong to the host; content modules add Writing and Reading. */
export const general: SettingsGroup = {
    id: 'general',
    label: 'General',
    fields: {
        siteTitle: field.string({ required: true, max: 120, default: 'My Site', label: 'Site title' }),
        tagline: field.string({ max: 200, default: 'Just another Cossack site', label: 'Tagline', description: 'In a few words, explain what this site is about.' }),
        adminEmail: field.string({ max: 254, default: '', pattern: '(?:[^\\s@]+@[^\\s@]+)?', label: 'Administration email address', description: 'Used for administration notices.' }),
        usersCanRegister: field.boolean({ default: false, label: 'Anyone can register' }),
        defaultRole: { ...field.string({ max: 80, default: 'subscriber', label: 'New user default role' }), source: 'roles' },
        timezone: { ...field.string({ max: 64, default: 'UTC', label: 'Timezone' }), source: 'timezones' },
        dateFormat: { ...field.enum(Object.keys(DATE_FORMATS), { default: 'long', label: 'Date format' }), choices: DATE_FORMATS },
        timeFormat: { ...field.enum(Object.keys(TIME_FORMATS), { default: '12h', label: 'Time format' }), choices: TIME_FORMATS },
        weekStartsOn: { ...field.enum(['sunday', 'monday', 'saturday'], { default: 'monday', label: 'Week starts on' }), choices: { sunday: 'Sunday', monday: 'Monday', saturday: 'Saturday' } },
        requireTwoFactor: field.boolean({ default: false, label: 'Require two-step sign-in for everyone who can use the dashboard', description: 'They add an authenticator app or a passkey before they can continue.' }),
        favicon: { ...field.string({ max: 2000, default: '', pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'Site icon', description: 'Shown in browser tabs and bookmarks: an SVG or a square PNG from the library.' }), source: 'media' },
        appIcon: { ...field.string({ max: 2000, default: '', pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'App icon', description: 'For home screens and the web app manifest: a square PNG of at least 512 pixels from the library; it is resized as needed.' }), source: 'media' },
        logo: { ...field.string({ max: 2000, default: '', pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'Logo', description: 'The site\'s logo in any shape, shown in the site header, on sign-in pages and in the dashboard. Search results use the square SEO logo.' }), source: 'media' },
    },
};

export const media: SettingsGroup = {
    id: 'media',
    label: 'Files',
    fields: {
        maxUploadMb: field.integer({ default: 100, min: 1, max: 1_000_000, label: 'Maximum upload size (MB)', description: 'Uploads go straight to the bucket, so the limit is yours to set.' }),
    },
};

/** The active theme, a plugin name. Changed under Appearance → Themes. */
export const appearance: SettingsGroup = {
    id: 'appearance',
    label: 'Appearance',
    permission: 'cms:appearance',
    fields: {
        theme: field.string({ max: 64, default: '', pattern: '(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*)?', label: 'Theme' }),
        /** The site's color changes and additions, by theme: `{ [theme]: { colors: { [slug]: value }, custom: Preset[] } }`. Checked by `presetOverridesProblem` on write. */
        presets: field.json({ label: 'Colors' }),
        /** Site-wide CSS added under Customize; `customCssProblem` keeps it to styling. */
        customCss: field.text({ max: 20_000, default: '', label: 'Additional CSS' }),
    },
};

export const writing: SettingsGroup = {
    id: 'writing',
    label: 'Writing',
    fields: {
        defaultCategory: { ...field.string({ max: 80, default: '', label: 'Default post category', description: 'Posts saved without a category get this one.' }), source: 'categories' },
        defaultStatus: { ...field.enum(['draft', 'published'], { default: 'draft', label: 'Default status of new posts' }), choices: { draft: 'Draft', published: 'Published' } },
    },
};

export const reading: SettingsGroup = {
    id: 'reading',
    label: 'Reading',
    fields: {
        showOnFront: { ...field.enum(['posts', 'page'], { default: 'posts', label: 'Your homepage displays' }), choices: { posts: 'Your latest posts', page: 'A static page' } },
        pageOnFront: { ...field.string({ max: 80, default: '', label: 'Homepage' }), source: 'pages' },
        pageForPosts: { ...field.string({ max: 80, default: '', label: 'Posts page', description: 'This page lists your latest posts, such as when the homepage is a static page or posts live at the site root.' }), source: 'pages' },
        postsPerPage: field.integer({ default: 10, min: 1, max: 100, label: 'Blog pages show at most' }),
        feedItems: field.integer({ default: 10, min: 1, max: 100, label: 'Syndication feeds show the most recent' }),
        feedContent: { ...field.enum(['excerpt', 'full'], { default: 'excerpt', label: 'For each post in a feed, include' }), choices: { excerpt: 'Excerpt', full: 'Full text' } },
        discourageSearchEngines: field.boolean({ default: false, label: 'Discourage search engines from indexing this site' }),
    },
};

/** Comments: who can post, what is held for moderation, and who is told. */
export const discussion: SettingsGroup = {
    id: 'discussion',
    label: 'Discussion',
    fields: {
        enabled: field.boolean({ default: true, label: 'Allow discussions', description: 'Off hides comments and their forms everywhere and refuses new ones. Stored comments are kept and can still be moderated.' }),
        defaultOpen: field.boolean({ default: true, label: 'Allow people to submit comments on new entries' }),
        requireNameEmail: field.boolean({ default: true, label: 'Comment authors must fill out their name and email' }),
        requireSignIn: field.boolean({ default: false, label: 'Users must be signed in to comment' }),
        closeAfterDays: field.integer({ default: 0, min: 0, max: 3650, label: 'Close comments on entries older than (days)', description: '0 keeps comments open.' }),
        threadDepth: field.integer({ default: 3, min: 1, max: 5, label: 'Nest replies up to this many levels' }),
        moderation: { ...field.enum(['all', 'first', 'none'], { default: 'first', label: 'Before a comment appears' }),
            choices: { all: 'It must be approved', first: 'Its author must have an earlier approved comment', none: 'Nothing: comments appear at once' } },
        maxLinks: field.integer({ default: 2, min: 0, max: 20, label: 'Hold a comment for moderation when it has at least this many links', description: '0 holds none for links.' }),
        blockedWords: field.text({ max: 5000, default: '', label: 'Disallowed words', description: 'One per line. A comment containing one in its content, name, email or URL goes to spam.' }),
        notifyPosted: field.boolean({ default: true, label: 'Email the administration address when anyone posts a comment' }),
        notifyHeld: field.boolean({ default: true, label: 'Email the administration address when a comment is held for moderation' }),
        notifyAuthor: field.boolean({ default: true, label: 'Email entry authors about comments on their entries' }),
    },
};

/** Separators between an entry's title and the site title in `<title>`. */
export const TITLE_SEPARATORS = Object.freeze({ dash: '–', pipe: '|', hyphen: '-', dot: '·', slash: '/', colon: ':' });

/** Site-wide search and sharing settings; entries override them in their SEO box. */
export const seo: SettingsGroup = {
    id: 'seo',
    label: 'SEO',
    fields: {
        titleSeparator: { ...field.enum(Object.keys(TITLE_SEPARATORS), { default: 'dash', label: 'Title separator', description: 'Between an entry\'s title and the site title.' }), choices: TITLE_SEPARATORS },
        homeTitle: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.home, label: 'Home page title', description: 'Variables: %site%, %tagline%, %sep%.' }),
        entryTitle: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.entry, label: 'Entry title', description: 'For entries without their own SEO title. Variables: %title%, %site%, %sep%, %tagline%, %author%, %collection%, %date%. A collection can set its own.' }),
        entryDescription: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.description, label: 'Entry description', description: 'For entries without their own meta description. Variables: %excerpt%, %title%, %site%, %author%, %date%.' }),
        archiveTitle: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.archive, label: 'Archive title', description: 'Collection archives. Variables: %title%, %site%, %sep%, %page%.' }),
        termTitle: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.term, label: 'Term archive title', description: 'Category and tag archives. Variables: %term%, %taxonomy%, %site%, %sep%, %page%.' }),
        authorTitle: field.string({ max: 300, default: SEO_TEMPLATE_DEFAULTS.author, label: 'Author page title', description: 'Variables: %author%, %site%, %sep%, %page%.' }),
        defaultImage: field.string({ max: 2000, default: '', pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'Default social image', description: 'Shown when a shared entry has no image: a URL from the media library or another site.' }),
        twitter: field.string({ max: 60, default: '', pattern: '(?:@?[A-Za-z0-9_]{1,50})?', label: 'X (Twitter) account', description: 'The site\'s handle, for cards of shared links.' }),
        representation: { ...field.enum(['organization', 'person'], { default: 'organization', label: 'The site represents', description: 'Who publishes the site, in structured data: an organization or a person.' }), choices: { organization: 'An organization', person: 'A person' } },
        publisherName: field.string({ max: 200, default: '', label: 'Organization or person name', description: 'The site title when empty.' }),
        logo: { ...field.string({ max: 2000, default: '', pattern: '(?:https?://[^\\s]+|/[^\\s]*)?', label: 'Logo', description: 'A square image of at least 112 pixels from the library; shown next to the site in search results and AI answers.' }), source: 'media' },
        sameAs: field.text({ max: 3000, default: '', label: 'Profiles', description: 'The publisher\'s profiles elsewhere, one URL per line: social accounts, Wikipedia, Wikidata, Crunchbase. They tell engines which entity the site is.' }),
        authorPages: field.boolean({ default: true, label: 'Author pages', description: 'Each author has a page at /author/<name> listing their entries, which their articles link to as the author.' }),
        maxImagePreview: { ...field.enum(['none', 'standard', 'large'], { default: 'large', label: 'Image previews in results', description: 'How large an image engines may show for the site\'s pages. Large is what Discover and AI answers use.' }), choices: { none: 'None', standard: 'Standard', large: 'Large' } },
        llmsTxt: field.boolean({ default: true, label: 'Serve /llms.txt', description: 'A plain-text map of the site for AI assistants: the site, its collections and their latest entries with summaries. No engine has committed to reading it; it costs nothing.' }),
        llmsTxtNotes: field.text({ max: 5000, default: '', label: 'Additional llms.txt sections', description: 'Markdown appended to the generated file: an About section, links to documentation, what to cite.' }),
        markdown: field.boolean({ default: true, label: 'Serve entries as Markdown', description: 'A request with Accept: text/markdown, or ?format=md, gets the entry as Markdown with front matter, the way agents read pages.' }),
        robotsTxt: field.text({ max: 5000, default: '', label: 'Additional robots.txt rules', description: 'Appended to the generated robots.txt.' }),
    },
};

/** Which crawlers robots.txt lets in, by what they do with the pages. */
export const crawlers: SettingsGroup = {
    id: 'crawlers',
    label: 'Crawlers',
    parent: 'seo',
    description: 'Crawlers by purpose. robots.txt asks; it does not enforce. Fetchers acting for a person (ChatGPT-User, Claude-User, Perplexity-User) ignore it, as browsers do.',
    fields: {
        allowSearch: field.boolean({ default: true, label: 'Search engines', description: 'Googlebot, Bingbot, Applebot, DuckDuckBot, Yandex, Baidu. Their indexes also feed AI Overviews, AI Mode and Copilot.' }),
        allowAiSearch: field.boolean({ default: true, label: 'AI search and answers', description: 'OAI-SearchBot (ChatGPT search), Claude-SearchBot, PerplexityBot. They cite the pages they index.' }),
        allowAiTraining: field.boolean({ default: true, label: 'AI training', description: 'GPTBot, ClaudeBot, Google-Extended, CCBot, Applebot-Extended, Bytespider, meta-externalagent, Amazonbot. Blocking keeps the site out of future models; Google-Extended also stops Gemini grounding.' }),
        contentSignals: field.boolean({ default: false, label: 'Add a Content-Signal line', description: 'States the same preferences in Cloudflare\'s Content-Signal format (search, ai-input, ai-train). Google and Bing ignore it; Cloudflare reads it.' }),
    },
};

/** IndexNow: pings Bing, Yandex, Naver and Seznam when entries change. */
export const indexnow: SettingsGroup = {
    id: 'indexnow',
    label: 'IndexNow',
    parent: 'seo',
    description: 'Tells Bing, Yandex, Naver and Seznam at once when a page is published, changed or removed, so their results and Copilot answers refresh within minutes. Google does not take part. Needs APP_URL.',
    fields: {
        enabled: field.boolean({ default: false, label: 'Ping IndexNow when entries change' }),
        key: field.string({ max: 128, default: '', pattern: '(?:[A-Za-z0-9-]{8,128})?', label: 'Key', description: 'Made for you when pings are on; served at /indexnow/<key>.txt. Paste your own to keep one you already registered.' }),
    },
};

/** The site's languages: the default one without a URL prefix, others under `/<code>/`. */
export const languages: SettingsGroup = {
    id: 'languages',
    label: 'Languages',
    fields: {
        default: field.string({ required: true, max: 16, default: 'en', pattern: '[a-z]{2,3}(?:-[a-z0-9]{2,8})?', label: 'Default language' }),
        others: field.string({ max: 300, default: '', pattern: '(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?(?:,[a-z]{2,3}(?:-[a-z0-9]{2,8})?){0,19})?', label: 'Other languages', description: 'Codes separated by commas, such as fr,de,pt-br.' }),
    },
};

/** Values of the built-in groups, with defaults applied. */
export interface SiteSettings {
    'general.siteTitle': string;
    'general.tagline': string;
    'general.adminEmail': string;
    'general.usersCanRegister': boolean;
    'general.defaultRole': string;
    'general.timezone': string;
    'general.dateFormat': keyof typeof DATE_FORMATS;
    'general.timeFormat': keyof typeof TIME_FORMATS;
    'general.weekStartsOn': 'sunday' | 'monday' | 'saturday';
    'general.requireTwoFactor': boolean;
    'general.favicon': string;
    'general.appIcon': string;
    'general.logo': string;
    'media.maxUploadMb': number;
    'appearance.theme': string;
    'appearance.presets': { readonly [theme: string]: { readonly colors?: { readonly [slug: string]: string }; readonly custom?: readonly { slug: string; name: string; value: string }[] } } | null;
    'appearance.customCss': string;
    'writing.defaultCategory': string;
    'writing.defaultStatus': 'draft' | 'published';
    'reading.showOnFront': 'posts' | 'page';
    'reading.pageOnFront': string;
    'reading.pageForPosts': string;
    'reading.postsPerPage': number;
    'reading.feedItems': number;
    'reading.feedContent': 'excerpt' | 'full';
    'reading.discourageSearchEngines': boolean;
    'discussion.enabled': boolean;
    'discussion.defaultOpen': boolean;
    'discussion.requireNameEmail': boolean;
    'discussion.requireSignIn': boolean;
    'discussion.closeAfterDays': number;
    'discussion.threadDepth': number;
    'discussion.moderation': 'all' | 'first' | 'none';
    'discussion.maxLinks': number;
    'discussion.blockedWords': string;
    'discussion.notifyPosted': boolean;
    'discussion.notifyHeld': boolean;
    'discussion.notifyAuthor': boolean;
    'seo.titleSeparator': keyof typeof TITLE_SEPARATORS;
    'seo.homeTitle': string;
    'seo.entryTitle': string;
    'seo.entryDescription': string;
    'seo.archiveTitle': string;
    'seo.termTitle': string;
    'seo.authorTitle': string;
    'seo.defaultImage': string;
    'seo.twitter': string;
    'seo.representation': 'organization' | 'person';
    'seo.publisherName': string;
    'seo.logo': string;
    'seo.sameAs': string;
    'seo.authorPages': boolean;
    'seo.maxImagePreview': 'none' | 'standard' | 'large';
    'seo.llmsTxt': boolean;
    'seo.llmsTxtNotes': string;
    'seo.markdown': boolean;
    'seo.robotsTxt': string;
    'crawlers.allowSearch': boolean;
    'crawlers.allowAiSearch': boolean;
    'crawlers.allowAiTraining': boolean;
    'crawlers.contentSignals': boolean;
    'indexnow.enabled': boolean;
    'indexnow.key': string;
    'languages.default': string;
    'languages.others': string;
    readonly [key: string]: unknown;
}

/** Format a time in the site's timezone and date format. */
export function formatSiteDate(value: number, settings: Pick<SiteSettings, 'general.timezone' | 'general.dateFormat'>, options: { time?: false | keyof typeof TIME_FORMATS } = {}): string {
    const timeZone = validTimeZone(settings['general.timezone']) ? settings['general.timezone'] : 'UTC';
    const date = new Date(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    const text = settings['general.dateFormat'] === 'iso' ? `${parts.year}-${parts.month}-${parts.day}`
        : settings['general.dateFormat'] === 'us' ? `${parts.month}/${parts.day}/${parts.year}`
        : settings['general.dateFormat'] === 'eu' ? `${parts.day}/${parts.month}/${parts.year}`
        : new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: settings['general.dateFormat'] === 'medium' ? 'medium' : 'long' }).format(date);
    if (!options.time) return text;
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: options.time === '12h' }).format(date);
    return `${text} ${options.time === '12h' ? time.toLowerCase() : time}`;
}

export function validTimeZone(zone: string): boolean {
    try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}
