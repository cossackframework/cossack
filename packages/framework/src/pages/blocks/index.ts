import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';

interface BlockCategory {
    title: string;
    description: string;
    href: string;
    count: number;
    /** Tailwind gradient classes for the card thumbnail. */
    accent: string;
    icon: string;
}

const CATEGORIES: BlockCategory[] = [
    {
        title: 'Login Forms',
        description: 'Authentication form layouts — centered card, split-screen, logo, multi-social.',
        href: '/blocks/login',
        count: 4,
        accent: 'from-blue-500 to-indigo-600',
        icon: '🔐',
    },
    {
        title: 'Dashboards',
        description: 'Admin dashboard shells — stats grid + table, sidebar layout, analytics, team.',
        href: '/blocks/dashboard',
        count: 4,
        accent: 'from-emerald-500 to-teal-600',
        icon: '📊',
    },
];

@Page({ transport: 'http' })
export default class BlocksIndex extends Cossack {
    public head(_context: HeadContext): HeadValue {
        return { title: 'Blocks' };
    }

    render(): TemplateResult {
        return html`
            <div class="min-h-screen bg-background">
                <!-- Header -->
                <header class="border-b border-border">
                    <div class="max-w-5xl mx-auto px-6 py-12">
                        <a href="/" class="text-sm text-muted-foreground hover:text-foreground">← Home</a>
                        <h1 class="text-3xl font-bold text-foreground mt-4">Blocks</h1>
                        <p class="text-muted-foreground mt-2 max-w-xl">
                            Ready-to-use UI patterns composed from the component library.
                            Each block is a self-contained section you can copy into your app.
                        </p>
                    </div>
                </header>

                <!-- Category grid -->
                <div class="max-w-5xl mx-auto px-6 py-8">
                    <div class="grid sm:grid-cols-2 gap-6">
                        ${CATEGORIES.map(cat => html`
                            <a
                                href=${cat.href}
                                class="group block rounded-xl border border-border overflow-hidden hover:border-primary/40 hover:shadow-lg transition-all cursor-pointer"
                            >
                                <!-- Thumbnail -->
                                <div class=${`h-32 bg-gradient-to-br ${cat.accent} flex items-center justify-center text-5xl`}>
                                    <span class="opacity-90 group-hover:scale-110 transition-transform">${cat.icon}</span>
                                </div>
                                <!-- Body -->
                                <div class="p-5">
                                    <div class="flex items-center justify-between">
                                        <h2 class="text-base font-semibold text-foreground">${cat.title}</h2>
                                        <span class="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">${cat.count} examples</span>
                                    </div>
                                    <p class="text-sm text-muted-foreground mt-1.5">${cat.description}</p>
                                    <span class="inline-flex items-center gap-1 text-sm text-primary mt-3 group-hover:gap-2 transition-all">
                                        View blocks
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    </span>
                                </div>
                            </a>
                        `)}
                    </div>

                    <!-- Info section -->
                    <div class="mt-12 p-6 rounded-xl bg-muted">
                        <h3 class="text-sm font-semibold text-foreground">About Blocks</h3>
                        <p class="text-sm text-muted-foreground mt-1.5">
                            Blocks sit one level above individual components — they compose multiple
                            UI components into complete application sections. Browse the examples above,
                            then copy the patterns into your own pages. Block source code lives in
                            <code class="text-xs bg-background px-1.5 py-0.5 rounded">src/pages/blocks/</code>.
                        </p>
                    </div>
                </div>
            </div>
        `;
    }
}
