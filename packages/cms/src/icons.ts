/**
 * The site icons: the Solar line icons blocks and themes show on the public site, by name. A
 * closed set, so a visitor downloads these and nothing else: `cms/site-icons.ts` in the
 * application maps each name to its artwork, `helpers.icon(name)` draws one, and the
 * dashboard's icon picker offers them for `field.icon()` fields.
 */
export const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SITE_ICON_NAMES: readonly string[] = Object.freeze([
    // Marks and states
    'check-circle', 'close-circle', 'add-circle', 'info-circle', 'question-circle', 'danger-triangle', 'star', 'stars', 'heart', 'like', 'smile-circle',
    // Energy and achievement
    'bolt', 'rocket', 'lightbulb', 'crown', 'medal-ribbon', 'cup', 'gift', 'confetti', 'target', 'flag',
    // Trust and technology
    'shield', 'shield-check', 'shield-star', 'lock', 'key', 'settings', 'code-square', 'cpu', 'server-2', 'database', 'cloud', 'global', 'earth',
    // Places and time
    'map', 'map-point', 'pin', 'home-2', 'buildings', 'bell', 'clock-circle', 'calendar', 'hourglass', 'history', 'refresh',
    // Numbers and money
    'chart', 'chart-2', 'chart-square', 'pie-chart', 'graph', 'course-up', 'course-down', 'dollar', 'euro', 'wallet', 'wallet-money', 'hand-money', 'hand-heart',
    // Commerce
    'cart-large-2', 'bag-4', 'shop', 'delivery', 'box', 'tag',
    // Contact and people
    'letter', 'mailbox', 'phone', 'chat-round-dots', 'chat-round-line', 'dialog', 'link', 'share', 'user', 'user-circle', 'user-id', 'user-plus', 'users-group-rounded', 'case',
    // Documents and learning
    'book', 'bookmark', 'notebook', 'document-text', 'notes', 'clipboard-list', 'checklist', 'list-check', 'diploma', 'square-academic-cap', 'pen', 'magnifier', 'eye',
    // Media and devices
    'camera', 'gallery', 'video-frame', 'play-circle', 'music-note', 'microphone', 'monitor', 'laptop', 'smartphone', 'tablet', 'palette', 'ruler', 'scale',
    // Nature, travel and health
    'leaf', 'sun', 'moon', 'fire', 'snowflake', 'umbrella', 'plane', 'bus', 'running', 'health', 'stethoscope', 'pills', 'hospital', 'bed',
    // Arrows
    'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'download-minimalistic', 'upload-minimalistic',
]);

export const SITE_ICON_SET: ReadonlySet<string> = new Set(SITE_ICON_NAMES);
