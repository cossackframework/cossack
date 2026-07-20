import { Cossack, Page, ClientState, State, Store, HeadContext, HeadValue } from '@cossackframework/core';
import { html, component, bind, type TemplateResult } from '@cossackframework/renderer';
import { Widget2Icon } from '@cossackframework/solar-icons/widget-2';
import { ChartIcon } from '@cossackframework/solar-icons/chart';
import { CartIcon } from '@cossackframework/solar-icons/cart';
import { UsersGroupRoundedIcon } from '@cossackframework/solar-icons/users-group-rounded';
import { SettingsIcon } from '@cossackframework/solar-icons/settings';
import {
    Card,
    CardHeader,
    CardBody,
    Badge,
    Button,
    Avatar,
    Progress,
    DropdownMenu,
    Sidebar,
} from '@cossackframework/ui';

interface RecentOrder {
    id: string;
    customer: string;
    email: string;
    amount: string;
    status: 'paid' | 'pending' | 'refunded';
    date: string;
}

const ORDERS: RecentOrder[] = [
    { id: 'INV-001', customer: 'Alice Johnson', email: 'alice@example.com', amount: '$240.00', status: 'paid', date: 'Jul 13' },
    { id: 'INV-002', customer: 'Bob Smith', email: 'bob@example.com', amount: '$120.50', status: 'pending', date: 'Jul 12' },
    { id: 'INV-003', customer: 'Carol White', email: 'carol@example.com', amount: '$890.00', status: 'paid', date: 'Jul 11' },
    { id: 'INV-004', customer: 'Dan Brown', email: 'dan@example.com', amount: '$45.00', status: 'refunded', date: 'Jul 10' },
    { id: 'INV-005', customer: 'Eve Davis', email: 'eve@example.com', amount: '$320.00', status: 'paid', date: 'Jul 09' },
];

const STATUS_VARIANT: Record<string, string> = {
    paid: 'success',
    pending: 'warning',
    refunded: 'destructive',
};

interface StatData {
    label: string;
    value: string;
    change: string;
    trend: 'up' | 'down';
}

const STATS: StatData[] = [
    { label: 'Total Revenue', value: '$45.2K', change: '+12.5%', trend: 'up' },
    { label: 'Active Users', value: '2,340', change: '+4.3%', trend: 'up' },
    { label: 'New Orders', value: '189', change: '-2.1%', trend: 'down' },
    { label: 'Conversion', value: '3.2%', change: '+0.8%', trend: 'up' },
];

@Page({ transport: 'http' })
export default class DashboardBlocks extends Cossack {
    @ClientState() tab = 0;

    // ── Reactive store: orders are filterable via search ──
    @Store() orders: RecentOrder[] = ORDERS;
    // ── Search filter (two-way bound) ──
    @State() search = '';

    /** Computed: orders filtered by the search query. */
    private get filteredOrders(): RecentOrder[] {
        const q = this.search.trim().toLowerCase();
        if (!q) return this.orders;
        return this.orders.filter(o =>
            o.customer.toLowerCase().includes(q) ||
            o.id.toLowerCase().includes(q) ||
            o.email.toLowerCase().includes(q),
        );
    }

    public head(_context: HeadContext): HeadValue {
        return { title: 'Dashboard Blocks' };
    }

    render(): TemplateResult {
        const tabs = ['Stats + Table', 'Sidebar Shell', 'Analytics', 'Team Overview'];

        return html`
            <div class="min-h-screen bg-background">
                <div class="border-b border-border sticky top-0 bg-background/80 backdrop-blur z-10">
                    <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <a href="/blocks" class="text-sm text-muted-foreground hover:text-foreground">← Blocks</a>
                            <span class="text-muted-foreground">/</span>
                            <h1 class="text-lg font-semibold">Dashboards</h1>
                        </div>
                        <div class="flex gap-1 bg-muted rounded-md p-1">
                            ${tabs.map((t, i) => html`
                                <button
                                    type="button"
                                    class=${`px-3 py-1.5 text-sm font-medium rounded-sm cursor-pointer border-none transition-colors ${this.tab === i ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground bg-transparent'}`}
                                    @click=${() => { this.tab = i; }}
                                >${t}</button>
                            `)}
                        </div>
                    </div>
                </div>

                <div>
                    ${this.tab === 0 ? this.statsTable() : null}
                    ${this.tab === 1 ? this.sidebarShell() : null}
                    ${this.tab === 2 ? this.analytics() : null}
                    ${this.tab === 3 ? this.teamOverview() : null}
                </div>
            </div>
        `;
    }

    // ─── Shared: stat cards grid ───────────────────────────────────
    private statCards(): TemplateResult {
        return html`
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                ${STATS.map(s => html`
                    <div class="rounded-lg border border-border bg-background p-4">
                        <p class="text-sm text-muted-foreground truncate">${s.label}</p>
                        <p class="text-2xl font-bold text-foreground mt-1">${s.value}</p>
                        <p class=${`text-xs font-medium mt-1 ${s.trend === 'down' ? 'text-destructive' : 'text-success'}`}>
                            ${s.change} <span class="text-muted-foreground">vs last month</span>
                        </p>
                    </div>
                `)}
            </div>
        `;
    }

    // ─── dashboard-01: Stats grid + recent orders table ──────────
    private statsTable(): TemplateResult {
        const orders = this.filteredOrders;
        return html`
            <div class="max-w-6xl mx-auto p-6 space-y-6">
                ${this.statCards()}
                <div class="rounded-lg border border-border bg-background">
                    <div class="flex items-center justify-between p-4 border-b border-border gap-4">
                        <div>
                            <h2 class="text-base font-semibold text-foreground">Recent Orders</h2>
                            <p class="text-sm text-muted-foreground">${orders.length} transaction${orders.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <input type="search" placeholder="Search orders..."
                                class="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-muted-foreground"
                                .value=${bind(this, 'search')} />
                            ${component(Button, { variant: 'outline', size: 'sm' }, 'Export')}
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full">
                            <thead>
                                <tr class="border-b border-border">
                                    <th class="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Order</th>
                                    <th class="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Customer</th>
                                    <th class="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Status</th>
                                    <th class="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Date</th>
                                    <th class="text-right text-xs font-medium text-muted-foreground px-4 py-2.5">Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${orders.length === 0 ? html`
                                    <tr><td colspan="5" class="px-4 py-8 text-center text-sm text-muted-foreground">No orders match "${this.search}"</td></tr>
                                ` : orders.map(o => html`
                                    <tr class="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                                        <td class="px-4 py-3 text-sm font-medium text-foreground">${o.id}</td>
                                        <td class="px-4 py-3">
                                            <div class="flex items-center gap-2">
                                                ${component(Avatar, { alt: o.customer, size: 28 })}
                                                <div>
                                                    <div class="text-sm font-medium text-foreground">${o.customer}</div>
                                                    <div class="text-xs text-muted-foreground">${o.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td class="px-4 py-3">
                                            ${component(Badge, { variant: STATUS_VARIANT[o.status] as any }, o.status)}
                                        </td>
                                        <td class="px-4 py-3 text-sm text-muted-foreground">${o.date}</td>
                                        <td class="px-4 py-3 text-sm font-semibold text-foreground text-right">${o.amount}</td>
                                    </tr>
                                `)}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // ─── dashboard-02: Sidebar shell + main content ────────────────
    private sidebarShell(): TemplateResult {
        return html`
            <div class="flex min-h-[600px] border-t border-border">
                ${component(Sidebar, {
                    title: 'Acme Inc',
                    width: '240px',
                    collapsible: 'icon',
                    items: [
                        { label: 'Dashboard', href: '#', icon: Widget2Icon, active: true },
                        { label: 'Analytics', href: '#', icon: ChartIcon },
                        { label: 'Orders', href: '#', icon: CartIcon, children: [
                            { label: 'All Orders', href: '#' },
                            { label: 'Refunds', href: '#' },
                        ]},
                        { label: 'Customers', href: '#', icon: UsersGroupRoundedIcon },
                        { label: 'Settings', href: '#', icon: SettingsIcon },
                    ],
                    footer: component(DropdownMenu, {
                        block: true,
                        side: 'right',
                        align: 'end',
                        trigger: html`
                            <span class="flex items-center gap-2.5 w-full px-1.5 py-1 rounded-md text-left group-[.is-collapsed]:justify-center">
                                ${component(Avatar, { src: 'https://avatars.githubusercontent.com/u/9004445?v=4', alt: 'Tan Nguyen', size: 32 })}
                                <span class="flex-1 min-w-0 group-[.is-collapsed]:hidden">
                                    <span class="block text-sm font-medium text-foreground truncate">Tan Nguyen</span>
                                    <span class="block text-xs text-muted-foreground truncate">hi@tan.ng</span>
                                </span>
                            </span>
                        `,
                    }, html`
                        <div class="px-3 py-2">
                            <div class="text-sm font-medium">Tan Nguyen</div>
                            <div class="text-xs text-muted-foreground">hi@tan.ng</div>
                        </div>
                        <div class="h-px bg-border my-1"></div>
                        <button class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left">Account</button>
                        <button class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-left">Settings</button>
                        <div class="h-px bg-border my-1"></div>
                        <button class="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-sm hover:bg-muted cursor-pointer border-none bg-transparent text-destructive text-left">Log out</button>
                    `),
                })}
                <div class="flex-1 p-6 space-y-6 overflow-x-hidden">
                    <div class="flex items-center justify-between">
                        <h2 class="text-xl font-bold text-foreground">Overview</h2>
                        <input type="search" placeholder="Search..."
                            class="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-muted-foreground"
                            .value=${bind(this, 'search')} />
                    </div>
                    ${this.statCards()}
                </div>
            </div>
        `;
    }

    // ─── dashboard-03: Analytics dashboard ─────────────────────────
    private analytics(): TemplateResult {
        const miniStats = [
            { label: 'Visitors', value: '48.2K', change: '+12%' },
            { label: 'Page Views', value: '142K', change: '+8%' },
            { label: 'Bounce Rate', value: '32%', change: '-3%' },
            { label: 'Avg. Session', value: '4m 12s', change: '+15%' },
        ];
        const trafficData = [40, 65, 45, 80, 55, 90, 70];
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const sources = [
            { src: 'Direct', pct: 42 },
            { src: 'Google', pct: 31 },
            { src: 'Twitter', pct: 15 },
            { src: 'Other', pct: 12 },
        ];

        return html`
            <div class="max-w-6xl mx-auto p-6 space-y-6">
                <div>
                    <h2 class="text-xl font-bold text-foreground">Analytics</h2>
                    <p class="text-sm text-muted-foreground">Traffic and engagement metrics for July 2025</p>
                </div>
                <!-- Mini stats row -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    ${miniStats.map(s => html`
                        <div class="rounded-lg border border-border bg-background p-4">
                            <p class="text-sm text-muted-foreground">${s.label}</p>
                            <p class="text-2xl font-bold text-foreground mt-1">${s.value}</p>
                            <p class="text-xs text-success mt-1">${s.change} vs last month</p>
                        </div>
                    `)}
                </div>
                <!-- Charts row -->
                <div class="grid lg:grid-cols-3 gap-4">
                    <!-- Bar chart -->
                    <div class="lg:col-span-2 rounded-lg border border-border bg-background p-4">
                        <h3 class="text-sm font-semibold text-foreground mb-4">Weekly Traffic</h3>
                        <div class="flex items-end gap-2 h-48">
                            ${trafficData.map((h, i) => html`
                                <div class="flex-1 flex flex-col items-center gap-1">
                                    <div class="w-full bg-primary/80 rounded-t-md transition-all" style="height:${h}%"></div>
                                    <span class="text-xs text-muted-foreground">${days[i]}</span>
                                </div>
                            `)}
                        </div>
                    </div>
                    <!-- Top sources -->
                    <div class="rounded-lg border border-border bg-background p-4">
                        <h3 class="text-sm font-semibold text-foreground mb-4">Top Sources</h3>
                        <div class="space-y-3">
                            ${sources.map(s => html`
                                <div>
                                    <div class="flex justify-between text-sm mb-1">
                                        <span class="text-foreground">${s.src}</span>
                                        <span class="text-muted-foreground">${s.pct}%</span>
                                    </div>
                                    ${component(Progress, { value: s.pct })}
                                </div>
                            `)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ─── dashboard-04: Team overview ───────────────────────────────
    private teamOverview(): TemplateResult {
        const team = [
            { name: 'Alice Johnson', role: 'CEO', email: 'alice@acme.dev', status: 'Active', img: 5 },
            { name: 'Bob Smith', role: 'CTO', email: 'bob@acme.dev', status: 'Active', img: 8 },
            { name: 'Carol White', role: 'Designer', email: 'carol@acme.dev', status: 'Away', img: 9 },
            { name: 'Dan Brown', role: 'Engineer', email: 'dan@acme.dev', status: 'Active', img: 11 },
            { name: 'Eve Davis', role: 'Marketing', email: 'eve@acme.dev', status: 'Offline', img: 16 },
        ];

        return html`
            <div class="max-w-6xl mx-auto p-6 space-y-6">
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-xl font-bold text-foreground">Team</h2>
                        <p class="text-sm text-muted-foreground">${team.length} members in your organization</p>
                    </div>
                    ${component(Button, { variant: 'default' }, '+ Invite member')}
                </div>
                <div class="rounded-lg border border-border bg-background">
                    <div class="divide-y divide-border">
                        ${team.map(m => html`
                            <div class="flex items-center gap-3 p-4 first:rounded-t-lg last:rounded-b-lg">
                                ${component(Avatar, { src: 'https://i.pravatar.cc/80?img=' + m.img, alt: m.name, size: 40 })}
                                <div class="flex-1 min-w-0">
                                    <div class="text-sm font-medium text-foreground">${m.name}</div>
                                    <div class="text-xs text-muted-foreground">${m.email}</div>
                                </div>
                                <span class="hidden sm:block text-sm text-muted-foreground">${m.role}</span>
                                ${component(Badge, {
                                    variant: m.status === 'Active' ? 'success' : m.status === 'Away' ? 'warning' : 'secondary',
                                }, m.status)}
                                ${component(DropdownMenu, {
                                    trigger: html`<span class="px-2 py-1 text-muted-foreground hover:text-foreground cursor-pointer inline-flex">⋯</span>`,
                                    side: 'bottom',
                                    align: 'end',
                                    items: [
                                        { label: 'View profile', onClick: () => {} },
                                        { label: 'Edit role', onClick: () => {} },
                                        { separator: true },
                                        { label: 'Remove', onClick: () => {} },
                                    ],
                                })}
                            </div>
                        `)}
                    </div>
                </div>
            </div>
        `;
    }
}
