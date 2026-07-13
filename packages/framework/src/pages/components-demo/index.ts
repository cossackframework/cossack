import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';
// Note: ClientState for sheetOpen is declared on the class below.
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';
import {
    Button,
    Input,
    Card,
    CardHeader,
    CardBody,
    CardFooter,
    Badge,
    Label,
    Alert,
    Modal,
    AccordionItem,
    Textarea,
    Checkbox,
    Switch,
    Select,
    Spinner,
    Avatar,
    AvatarGroup,
    Separator,
    Skeleton,
    Progress,
    Tabs,
    Tooltip,
    Popover,
    RadioGroup,
    Slider,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    Toaster,
    toast,
    DropdownMenu,
    Sheet,
    Collapsible,
    Toggle,
    ToggleGroup,
    Breadcrumb,
    Pagination,
    AspectRatio,
    Field,
    Empty,
    Kbd,
    ButtonGroup,
    AlertDialog,
    HoverCard,
    ScrollArea,
    Resizable,
    Carousel,
    NavigationMenu,
    Menubar,
    Command,
    Combobox,
    Calendar,
    DatePicker,
    ContextMenu,
    InputOTP,
    Typography,
    Drawer,
    Sidebar,
    NativeSelect,
    InputGroup,
    Item,
    Bubble,
    Message,
    MessageScroller,
    Marker,
    Attachment,
    PasswordInput,
    MultiSelect,
    Icon,
} from '@cossackframework/ui';

@Page()
export class ComponentsDemo extends Cossack {
    @ClientState() modalOpen = false;
    @ClientState() sheetOpen = false;
    @ClientState() alertOpen = false;
    @ClientState() drawerOpen = false;
    @ClientState() calendarDate = '2025-07-04';
    @ClientState() datePickerDate: string | undefined = undefined;
    @ClientState() otpValue = '';
    @ClientState() password = '';
    @ClientState() skills: string[] = ['TypeScript', 'React'];

    public head(_context: HeadContext): HeadValue {
        return {
            title: 'Components Demo',
        };
    }

    render(): TemplateResult {
        return component(Layout, { dir: 'ltr' }, html`
            <div class="space-y-8 max-w-3xl">
                <h1>Components Demo</h1>
                <p class="text-muted-foreground">
                    Gallery of <code>@cossackframework/ui</code> components, themed
                    by the token layer wired into <code>style.css</code>.
                </p>

                <!-- Buttons -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Buttons</h2>
                    <div class="flex flex-wrap items-center gap-3">
                        ${component(Button, { variant: 'primary' }, 'Primary')}
                        ${component(Button, { variant: 'secondary' }, 'Secondary')}
                        ${component(Button, { variant: 'outline' }, 'Outline')}
                        ${component(Button, { variant: 'ghost' }, 'Ghost')}
                        ${component(Button, { variant: 'destructive' }, 'Delete')}
                    </div>
                    <div class="flex flex-wrap items-center gap-3">
                        ${component(Button, { size: 'sm' }, 'Small')}
                        ${component(Button, { size: 'md' }, 'Medium')}
                        ${component(Button, { size: 'lg' }, 'Large')}
                        ${component(Button, { variant: 'primary', block: false, disabled: true }, 'Disabled')}
                    </div>
                </section>

                <!-- Badges -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Badges</h2>
                    <div class="flex flex-wrap items-center gap-2">
                        ${component(Badge, { variant: 'primary' }, 'Primary')}
                        ${component(Badge, { variant: 'secondary' }, 'Secondary')}
                        ${component(Badge, { variant: 'success' }, 'Active')}
                        ${component(Badge, { variant: 'warning' }, 'Pending')}
                        ${component(Badge, { variant: 'destructive' }, 'Failed')}
                        ${component(Badge, { variant: 'outline' }, 'Outline')}
                    </div>
                </section>

                <!-- Form controls -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Form Controls</h2>
                    <div class="space-y-2">
                        ${component(Label, { for: 'email-demo' }, 'Email')}
                        ${component(Input, { id: 'email-demo', type: 'email', placeholder: 'you@example.com' })}
                    </div>
                    <div class="space-y-2">
                        ${component(Label, { for: 'err-demo', muted: true }, 'With error')}
                        ${component(Input, { id: 'err-demo', variant: 'error', placeholder: 'Invalid input' })}
                    </div>
                </section>

                <!-- Alerts -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Alerts</h2>
                    <div class="space-y-2">
                        ${component(Alert, { variant: 'info', accent: true }, html`<strong>Heads up.</strong> This is an informational alert.`)}
                        ${component(Alert, { variant: 'success', accent: true }, html`<strong>Success.</strong> Your changes were saved.`)}
                        ${component(Alert, { variant: 'warning', accent: true }, html`<strong>Warning.</strong> Review before continuing.`)}
                        ${component(Alert, { variant: 'destructive', accent: true }, html`<strong>Error.</strong> Something went wrong.`)}
                    </div>
                </section>

                <!-- Card -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Card</h2>
                    ${component(Card, { interactive: false }, html`
                        ${component(CardHeader, {}, html`<h3 class="text-base font-semibold">Plan: Pro</h3>`)}
                        ${component(CardBody, {}, html`
                            <p>Unlimited projects and priority support.</p>
                            <p class="mt-2">${component(Badge, { variant: 'success' }, 'Recommended')}</p>
                        `)}
                        ${component(CardFooter, {}, html`
                            <div class="flex justify-end gap-2">
                                ${component(Button, { variant: 'ghost', size: 'sm' }, 'Dismiss')}
                                ${component(Button, { variant: 'primary', size: 'sm' }, 'Upgrade')}
                            </div>
                        `)}
                    `)}
                </section>

                <!-- Icons -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Icons</h2>
                    <div class="flex flex-wrap items-center gap-4 text-foreground">
                        ${component(Icon, { name: 'arrow-right', size: 24, label: 'Arrow right' })}
                        ${component(Icon, { name: 'check', size: 24, label: 'Check' })}
                        ${component(Icon, { name: 'close', size: 24, label: 'Close' })}
                        ${component(Icon, { name: 'warning', size: 24, label: 'Warning' })}
                        ${component(Icon, { name: 'check', style: 'duotone', size: 32 })}
                        ${component(Icon, { name: 'check', style: 'bold', size: 32 })}
                        ${component(Icon, { name: 'check', style: 'broken', size: 32 })}
                    </div>
                </section>

                <!-- Modal -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Modal</h2>
                    <div class="flex items-center gap-3">
                        ${component(Button, { '@click': () => { this.modalOpen = true; } }, 'Open modal')}
                        ${component(Spinner, { size: 20, label: 'Loading' })}
                    </div>
                    ${component(
                        Modal,
                        {
                            open: this.modalOpen,
                            onClose: () => { this.modalOpen = false; },
                        },
                        html`
                            <h3 class="text-lg font-semibold mb-2">Confirm action</h3>
                            <p class="text-sm text-muted-foreground mb-5">Are you sure you want to continue? This cannot be undone.</p>
                            <div class="flex justify-end gap-2">
                                ${component(Button, { variant: 'ghost', size: 'sm', '@click': () => { this.modalOpen = false; } }, 'Cancel')}
                                ${component(Button, { variant: 'primary', size: 'sm', '@click': () => { this.modalOpen = false; } }, 'Confirm')}
                            </div>
                        `,
                    )}
                </section>

                <!-- Accordion -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Accordion</h2>
                    <div class="space-y-2">
                        ${component(AccordionItem, { defaultOpen: true, summary: 'What is Cossack?' }, html`<p class="text-sm">A full-stack TypeScript framework for Cloudflare Workers and Node.js.</p>`)}
                        ${component(AccordionItem, { summary: 'Why native elements?' }, html`<p class="text-sm">They handle accessibility, keyboard, and form participation for free.</p>`)}
                        ${component(AccordionItem, { summary: 'Does this need JavaScript?' }, html`<p class="text-sm">The accordion uses a div+button+state pattern for smooth height animation.</p>`)}
                    </div>
                </section>

                <!-- Form controls (extended) -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Form Controls (Extended)</h2>
                    <div class="space-y-3 max-w-md">
                        ${component(Label, { for: 'bio' }, 'Bio')}
                        ${component(Textarea, { id: 'bio', rows: 4, placeholder: 'Tell us about yourself' })}
                        ${component(Label, { for: 'country' }, 'Country')}
                        ${component(Select, { id: 'country' }, html`<option>United States</option><option>Vietnam</option><option>Germany</option>`)}
                        <div class="flex items-center gap-6 pt-2">
                            ${component(Checkbox, { checked: true }, 'Subscribe to newsletter')}
                            ${component(Switch, { checked: true })}
                        </div>
                    </div>
                </section>

                <!-- Avatar, Separator, Skeleton -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Avatar · Separator · Skeleton</h2>
                    <div class="flex items-center gap-4">
                        ${component(Avatar, { src: 'https://avatars.githubusercontent.com/u/9919?v=4', alt: 'GitHub', size: 48 })}
                        ${component(Avatar, { alt: 'Tan Nguyen', size: 48 })}
                        ${component(Separator, { orientation: 'vertical' })}
                        ${component(Skeleton, { width: '120px', height: '12px' })}
                    </div>
                </section>

                <!-- AvatarGroup -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">AvatarGroup</h2>
                    <div class="flex flex-col gap-4">
                        <div class="flex items-center gap-6">
                            ${component(AvatarGroup, {
                                max: 4,
                                size: 36,
                                items: [
                                    { src: 'https://i.pravatar.cc/80?img=1', alt: 'Alice' },
                                    { src: 'https://i.pravatar.cc/80?img=2', alt: 'Bob' },
                                    { src: 'https://i.pravatar.cc/80?img=3', alt: 'Carol' },
                                    { src: 'https://i.pravatar.cc/80?img=4', alt: 'Dan' },
                                    { src: 'https://i.pravatar.cc/80?img=5', alt: 'Eve' },
                                    { src: 'https://i.pravatar.cc/80?img=6', alt: 'Frank' },
                                ],
                            })}
                            <span class="text-sm text-muted-foreground">6 members, max 4 shown</span>
                        </div>
                        <div class="flex items-center gap-6">
                            ${component(AvatarGroup, {
                                max: 3,
                                size: 28,
                                shape: 'square',
                                items: [
                                    { src: 'https://i.pravatar.cc/80?img=7', alt: 'Grace' },
                                    { src: 'https://i.pravatar.cc/80?img=8', alt: 'Henry' },
                                    { src: 'https://i.pravatar.cc/80?img=9', alt: 'Ivy' },
                                    { src: 'https://i.pravatar.cc/80?img=10', alt: 'Jack' },
                                    { alt: 'KL' },
                                ],
                            })}
                            <span class="text-sm text-muted-foreground">Square, max 3, initials fallback</span>
                        </div>
                    </div>
                </section>

                <!-- Progress -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Progress</h2>
                    <div class="space-y-2 max-w-md">
                        ${component(Progress, { value: 25, size: 'sm' })}
                        ${component(Progress, { value: 60, size: 'md' })}
                        ${component(Progress, { value: 90, size: 'lg' })}
                    </div>
                </section>

                <!-- Tabs -->
                <section class="space-y-4">
                    <h2 class="text-lg font-semibold">Tabs</h2>
                    <div class="space-y-2">
                        <span class="text-xs text-muted-foreground">Pill variant (animated slide)</span>
                        ${component(Tabs, {
                            variant: 'pill',
                            items: [
                                { value: 'account', label: 'Account', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.5"/></svg>`, content: html`<p class="text-sm">Account settings content. The pill indicator slides smoothly.</p>` },
                                { value: 'password', label: 'Password', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="1.5"/></svg>`, content: html`<p class="text-sm">Password settings content.</p>` },
                                { value: 'team', label: 'Team', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zm14 10v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`, content: html`<p class="text-sm">Team settings content.</p>` },
                            ],
                        })}
                    </div>
                    <div class="space-y-2">
                        <span class="text-xs text-muted-foreground">Underline variant</span>
                        ${component(Tabs, {
                            variant: 'underline',
                            items: [
                                { value: 'overview', label: 'Overview', content: html`<p class="text-sm">Overview content. The underline indicator slides between tabs.</p>` },
                                { value: 'analytics', label: 'Analytics', content: html`<p class="text-sm">Analytics content.</p>` },
                                { value: 'reports', label: 'Reports', content: html`<p class="text-sm">Reports content.</p>` },
                                { value: 'notifications', label: 'Notifications', content: html`<p class="text-sm">Notifications content.</p>` },
                            ],
                        })}
                    </div>
                    <div class="space-y-2">
                        <span class="text-xs text-muted-foreground">Vertical orientation</span>
                        <div class="border border-border rounded-lg p-4" style="min-height: 180px;">
                            ${component(Tabs, {
                                orientation: 'vertical',
                                items: [
                                    { value: 'general', label: 'General', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>`, content: html`<p class="text-sm">General settings. Vertical tabs are great for settings pages.</p>` },
                                    { value: 'security', label: 'Security', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 7v6c0 5 3.5 8.5 9 10 5.5-1.5 9-5 9-10V7l-9-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`, content: html`<p class="text-sm">Security settings — 2FA, password, sessions.</p>` },
                                    { value: 'billing', label: 'Billing', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/></svg>`, content: html`<p class="text-sm">Billing settings — plan, invoices, payment.</p>` },
                                    { value: 'api', label: 'API Keys', icon: html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`, content: html`<p class="text-sm">API key management.</p>` },
                                ],
                            })}
                        </div>
                    </div>
                </section>

                <!-- Tooltip -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Tooltip</h2>
                    <div class="flex items-center gap-4">
                        ${component(Tooltip, { label: 'Save changes', side: 'top' }, component(Button, { variant: 'primary' }, 'Hover me'))}
                    </div>
                </section>

                <!-- Popover -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Popover</h2>
                    ${component(Popover, { trigger: 'Open popover' }, html`
                        <h3 class="text-base font-semibold mb-1">Popover title</h3>
                        <p class="text-sm text-muted-foreground">This uses the native <code>popover</code> attribute — top-layer rendering, light dismiss, no portal.</p>
                    `)}
                </section>

                <!-- Radio Group + Slider -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Radio Group · Slider</h2>
                    <div class="space-y-4 max-w-md">
                        ${component(RadioGroup, {
                            name: 'plan',
                            value: 'pro',
                            items: [
                                { value: 'free', label: 'Free' },
                                { value: 'pro', label: 'Pro' },
                                { value: 'enterprise', label: 'Enterprise' },
                            ],
                        })}
                        ${component(Slider, { value: 40, label: 'Volume' })}
                    </div>
                </section>

                <!-- Table -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Table</h2>
                    ${component(Table, { striped: true }, html`
                        <thead>
                            <tr>
                                <th class="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Name</th>
                                <th class="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Role</th>
                                <th class="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr class="border-b border-border">
                                <td class="px-4 py-3 text-sm">Tan Nguyen</td>
                                <td class="px-4 py-3 text-sm">Admin</td>
                                <td class="px-4 py-3 text-sm">${component(Badge, { variant: 'success' }, 'Active')}</td>
                            </tr>
                            <tr class="border-b border-border">
                                <td class="px-4 py-3 text-sm">Jane Doe</td>
                                <td class="px-4 py-3 text-sm">Editor</td>
                                <td class="px-4 py-3 text-sm">${component(Badge, { variant: 'warning' }, 'Pending')}</td>
                            </tr>
                        </tbody>
                    `)}
                </section>

                <!-- Toast + Dropdown Menu + Sheet -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Toast · Dropdown · Sheet</h2>
                    <div class="flex flex-wrap items-center gap-3">
                        ${component(Button, { '@click': () => toast.success('Saved successfully!') }, 'Toast: Success')}
                        ${component(Button, { variant: 'secondary', '@click': () => toast.warning('This is a warning.') }, 'Toast: Warning')}
                        ${component(Button, { variant: 'destructive', '@click': () => toast.error('Something went wrong.') }, 'Toast: Error')}
                        ${component(DropdownMenu, {
                            trigger: 'Dropdown',
                            side: 'bottom',
                            items: [
                                { label: 'Profile' },
                                { label: 'Settings' },
                                { separator: true },
                                { label: 'Sign out', onClick: () => toast.show('Signed out') },
                            ],
                        })}
                        ${component(Button, { variant: 'outline', '@click': () => { this.sheetOpen = true; } }, 'Open Sheet')}
                    </div>
                </section>

                <!-- Sheet -->
                ${component(
                    Sheet,
                    {
                        open: this.sheetOpen,
                        side: 'right',
                        onClose: () => { this.sheetOpen = false; },
                    },
                    html`
                        <div class="p-6">
                            <h3 class="text-lg font-semibold mb-3">Sheet Panel</h3>
                            <p class="text-sm text-muted-foreground mb-5">This slides in from the right edge using the native <code>&lt;dialog&gt;</code> top layer.</p>
                            <div class="flex justify-end gap-2">
                                ${component(Button, { variant: 'ghost', size: 'sm', '@click': () => { this.sheetOpen = false; } }, 'Close')}
                            </div>
                        </div>
                    `,
                )}

                <!-- Collapsible + Toggle + ToggleGroup -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Collapsible · Toggle · ToggleGroup</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        ${component(Collapsible, { trigger: component(Button, { variant: 'outline', size: 'sm' }, 'Toggle Collapsible') }, html`<p class="text-sm py-3">Content that can be shown or hidden.</p>`)}
                        ${component(Toggle, { defaultPressed: true }, 'Bold')}
                        ${component(ToggleGroup, {
                            type: 'single',
                            value: 'left',
                            items: [
                                { value: 'left', label: 'Left' },
                                { value: 'center', label: 'Center' },
                                { value: 'right', label: 'Right' },
                            ],
                        })}
                    </div>
                </section>

                <!-- Breadcrumb + Pagination + Kbd -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Breadcrumb · Pagination · Kbd</h2>
                    <div class="space-y-4">
                        ${component(Breadcrumb, { items: [
                            { label: 'Home', href: '/' },
                            { label: 'Components', href: '/components-demo' },
                            { label: 'Current' },
                        ]})}
                        ${component(Pagination, { page: 3, totalPages: 10 })}
                        <div class="flex items-center gap-1">
                            <span class="text-sm text-muted-foreground mr-2">Press</span>
                            ${component(Kbd, {}, '⌘')}
                            ${component(Kbd, {}, 'K')}
                        </div>
                    </div>
                </section>

                <!-- AspectRatio + Field + Empty -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">AspectRatio · Field · Empty</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        <div class="w-48">
                            ${component(AspectRatio, { ratio: 16 / 9 }, html`<div class="w-full h-full bg-muted rounded-md flex items-center justify-center text-muted-foreground text-xs">16:9</div>`)}
                        </div>
                        <div class="flex-1 min-w-[200px] max-w-xs">
                            ${component(Field, { label: 'Username', hint: '3-20 characters', for: 'username-demo' },
                                component(Input, { id: 'username-demo', placeholder: 'username' }))}
                        </div>
                        <div class="border border-border rounded-lg w-56">
                            ${component(Empty, { title: 'No items', description: 'Add your first item to get started.' })}
                        </div>
                    </div>
                </section>

                <!-- ButtonGroup -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">ButtonGroup</h2>
                    ${component(ButtonGroup, {},
                        html`<button class="px-3 py-1.5 text-sm border border-r-0 border-border bg-background text-foreground hover:bg-muted cursor-pointer rounded-l-md">Left</button>
                             <button class="px-3 py-1.5 text-sm border border-r-0 border-border bg-background text-foreground hover:bg-muted cursor-pointer">Center</button>
                             <button class="px-3 py-1.5 text-sm border border-border bg-background text-foreground hover:bg-muted cursor-pointer rounded-r-md">Right</button>`)}
                </section>

                <!-- AlertDialog + HoverCard -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">AlertDialog · HoverCard</h2>
                    <div class="flex flex-wrap items-center gap-4">
                        ${component(Button, { variant: 'destructive', '@click': () => { this.alertOpen = true; } }, 'Delete Account')}
                        ${component(HoverCard, {
                            content: html`<div><p class="text-sm font-medium mb-1">Hover details</p><p class="text-xs text-muted-foreground">This card appears on hover with a 300ms delay.</p></div>`,
                        }, component(Button, { variant: 'outline' }, 'Hover me'))}
                    </div>
                    ${component(AlertDialog, {
                        open: this.alertOpen,
                        title: 'Delete account?',
                        description: 'This will permanently delete your account and all associated data. This action cannot be undone.',
                        cancelLabel: 'Cancel',
                        actionLabel: 'Delete',
                        actionVariant: 'destructive',
                        onAction: () => { toast.error('Account deleted.'); this.alertOpen = false; },
                        onClose: () => { this.alertOpen = false; },
                    })}
                </section>

                <!-- ScrollArea + Resizable -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">ScrollArea · Resizable</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        <div class="border border-border rounded-lg w-64">
                            ${component(ScrollArea, { height: '120px' }, html`
                                <div class="p-3 space-y-1">
                                    <p class="text-sm">Scroll me!</p>
                                    ${[1,2,3,4,5,6,7,8,9,10].map(i => html`<p class="text-xs text-muted-foreground">Item ${i}</p>`)}
                                </div>
                            `)}
                        </div>
                        <div class="border border-border rounded-lg w-96 h-32">
                            ${component(Resizable, { defaultWidth: 150 },
                                html`<div class="p-3 text-sm">Left panel — drag the handle →</div>`)}
                        </div>
                    </div>
                </section>

                <!-- Carousel -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Carousel</h2>
                    ${component(Carousel, {},
                        html`${[1,2,3,4,5].map(i => html`
                            <div class="snap-start shrink-0 w-48 h-32 rounded-lg bg-muted flex items-center justify-center text-muted-foreground text-lg font-medium border border-border">Slide ${i}</div>
                        `)}`)}
                </section>

                <!-- NavigationMenu + Menubar -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">NavigationMenu · Menubar</h2>
                    <div class="space-y-4">
                        ${component(NavigationMenu, { sections: [
                            { label: 'Products', items: [
                                { label: 'Core', href: '#', description: 'The framework' },
                                { label: 'UI', href: '#', description: 'Components library' },
                            ]},
                            { label: 'Docs', items: [
                                { label: 'Getting Started', href: '#' },
                                { label: 'API Reference', href: '#' },
                            ]},
                        ]})}
                        ${component(Menubar, { menus: [
                            { label: 'File', items: [
                                { label: 'New File', onClick: () => toast.show('New File') },
                                { label: 'Open...', onClick: () => toast.show('Open') },
                                { separator: true },
                                { label: 'Exit', onClick: () => toast.show('Exit') },
                            ]},
                            { label: 'Edit', items: [
                                { label: 'Undo', onClick: () => toast.show('Undo') },
                                { label: 'Redo', onClick: () => toast.show('Redo') },
                            ]},
                        ]})}
                    </div>
                </section>

                <!-- Command (⌘K) + Combobox -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Command · Combobox</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        <div class="flex flex-col gap-2">
                            <p class="text-sm text-muted-foreground">Press <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1 text-xs font-medium rounded border border-border bg-muted">⌘</kbd> <kbd class="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1 text-xs font-medium rounded border border-border bg-muted">K</kbd> anywhere</p>
                            ${component(Command, {
                                items: [
                                    { id: 'home', label: 'Go to Home', group: 'Navigation' },
                                    { id: 'settings', label: 'Open Settings', group: 'Navigation' },
                                    { id: 'profile', label: 'View Profile', group: 'Account' },
                                    { id: 'logout', label: 'Log Out', group: 'Account' },
                                ],
                                onSelect: (id: string) => toast.show('Selected: ' + id),
                            })}
                        </div>
                        <div class="w-56">
                            ${component(Combobox, {
                                options: [
                                    { value: 'us', label: 'United States' },
                                    { value: 'vn', label: 'Vietnam' },
                                    { value: 'de', label: 'Germany' },
                                    { value: 'jp', label: 'Japan' },
                                    { value: 'au', label: 'Australia' },
                                ],
                                placeholder: 'Select a country...',
                                onChange: (v: string) => toast.show('Country: ' + v),
                            })}
                        </div>
                    </div>
                </section>

                <!-- Calendar + DatePicker -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Calendar · DatePicker</h2>
                    <div class="flex flex-wrap items-start gap-8">
                        <div class="flex flex-col gap-2">
                            <span class="text-sm text-muted-foreground">Selected: ${this.calendarDate}</span>
                            ${component(Calendar, {
                                value: this.calendarDate,
                                onChange: (iso: string) => { this.calendarDate = iso; },
                            })}
                        </div>
                        <div class="w-56">
                            <span class="text-sm text-muted-foreground mb-2 block">Pick a due date</span>
                            ${component(DatePicker, {
                                value: this.datePickerDate,
                                placeholder: 'Select date...',
                                onChange: (iso: string) => { this.datePickerDate = iso; },
                            })}
                        </div>
                    </div>
                </section>

                <!-- ContextMenu -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">ContextMenu</h2>
                    <p class="text-sm text-muted-foreground">Right-click the box below.</p>
                    ${component(ContextMenu, {
                        items: [
                            { label: 'Copy', onClick: () => toast.show('Copied') },
                            { label: 'Paste', onClick: () => toast.show('Pasted') },
                            { separator: true },
                            { label: 'Archive', onClick: () => toast.show('Archived') },
                            { label: 'Delete', destructive: true, onClick: () => toast.error('Deleted') },
                        ],
                    }, html`<div class="border-2 border-dashed border-border rounded-lg p-8 text-center text-muted-foreground w-full max-w-sm">Right-click here</div>`)}
                </section>

                <!-- InputOTP -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">InputOTP</h2>
                    <p class="text-sm text-muted-foreground">Type or paste a 6-digit code. Current: <code class="text-xs bg-muted px-1.5 py-0.5 rounded">${this.otpValue || '—'}</code></p>
                    ${component(InputOTP, {
                        length: 6,
                        onChange: (v: string) => { this.otpValue = v; },
                        onComplete: (v: string) => toast.success('Code entered: ' + v),
                    })}
                </section>

                <!-- Typography -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Typography</h2>
                    <div class="space-y-4">
                        ${component(Typography, { variant: 'h1' }, 'The quick brown fox')}
                        ${component(Typography, { variant: 'h2' }, 'Jumps over the lazy dog')}
                        ${component(Typography, { variant: 'h3' }, 'A sub-heading')}
                        ${component(Typography, { variant: 'lead' }, 'A short, friendly lead paragraph that sets the tone.')}
                        ${component(Typography, { variant: 'p' }, html`Body copy with an <strong>inline emphasis</strong> and <code class="bg-muted px-1 rounded">inline code</code>.`)}
                        ${component(Typography, { variant: 'blockquote' }, '"Good design is as little design as possible." — Dieter Rams')}
                        ${component(Typography, { variant: 'ul' }, html`<li>First bullet point</li><li>Second bullet point</li><li>Third bullet point</li>`)}
                    </div>
                </section>

                <!-- Drawer -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Drawer</h2>
                    <div class="flex flex-wrap items-center gap-3">
                        ${component(Button, { '@click': () => { this.drawerOpen = true; } }, 'Open Drawer')}
                        ${component(Button, { variant: 'outline', '@click': () => { this.drawerOpen = true; } }, 'Filters')}
                    </div>
                    ${component(Drawer, {
                        open: this.drawerOpen,
                        side: 'right',
                        title: 'Settings',
                        onClose: () => { this.drawerOpen = false; },
                    }, html`
                        <div class="space-y-4">
                            <p class="text-sm text-muted-foreground">Configure your preferences.</p>
                            <div class="space-y-3">
                                <div class="flex items-center justify-between">
                                    <span class="text-sm">Email notifications</span>
                                    ${component(Switch, { checked: true })}
                                </div>
                                <div class="flex items-center justify-between">
                                    <span class="text-sm">Dark mode</span>
                                    ${component(Switch, { checked: false })}
                                </div>
                            </div>
                        </div>
                    `)}
                </section>

                <!-- Sidebar -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Sidebar</h2>
                    <p class="text-sm text-muted-foreground">
                        Collapsible navigation. The footer slot is agnostic — here it renders a
                        user-menu trigger composed from <code>Avatar</code> + <code>DropdownMenu</code>.
                        On mobile the menu opens upward (collision-aware positioning).
                    </p>
                    <div class="border border-border rounded-lg overflow-hidden" style="height: 380px;">
                        ${component(Sidebar, {
                            title: 'Acme Inc',
                            items: [
                                { label: 'Dashboard', href: '#', icon: 'home', active: true },
                                { label: 'Projects', href: '#', icon: 'folder', children: [
                                    { label: 'Active', href: '#' },
                                    { label: 'Archived', href: '#' },
                                ]},
                                { label: 'Team', href: '#', icon: 'users' },
                                { label: 'Settings', href: '#', icon: 'settings' },
                            ],
                            collapsible: 'icon',
                            onNavigate: (item: any) => toast.show('Navigate: ' + item.label),
                            // Footer slot: arbitrary content. Here a user-menu trigger.
                            // side:'right' opens the menu beside the trigger (desktop);
                            // collision-aware flip handles tight/mobile viewports.
                            // group-[.is-collapsed] classes hide the name/email/chevron
                            // when the sidebar collapses to its icon rail.
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
                                        <svg class="w-4 h-4 text-muted-foreground shrink-0 group-[.is-collapsed]:hidden" viewBox="0 0 24 24" fill="none">
                                            <path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                        </svg>
                                    </span>
                                `,
                            }, html`
                                <!-- Identity header -->
                                <div class="flex items-center gap-2.5 px-3 py-2">
                                    ${component(Avatar, { src: 'https://avatars.githubusercontent.com/u/9004445?v=4', alt: 'Tan Nguyen', size: 36 })}
                                    <div class="min-w-0">
                                        <div class="text-sm font-medium text-foreground truncate">Tan Nguyen</div>
                                        <div class="text-xs text-muted-foreground truncate">hi@tan.ng</div>
                                    </div>
                                </div>
                                <hr class="border-t border-border my-1" />
                                <!-- Upgrade banner -->
                                <button type="button" class="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm cursor-pointer border-none bg-transparent text-foreground hover:bg-muted text-left">
                                    <svg class="w-4 h-4 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7l3-7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                                    <span class="flex-1">Upgrade to Pro</span>
                                </button>
                                <hr class="border-t border-border my-1" />
                                <!-- Account links -->
                                <button type="button" class="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm cursor-pointer border-none bg-transparent text-foreground hover:bg-muted text-left">
                                    <svg class="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                                    <span class="flex-1">Account</span>
                                </button>
                                <button type="button" class="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm cursor-pointer border-none bg-transparent text-foreground hover:bg-muted text-left">
                                    <svg class="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/></svg>
                                    <span class="flex-1">Billing</span>
                                </button>
                                <button type="button" class="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm cursor-pointer border-none bg-transparent text-foreground hover:bg-muted text-left">
                                    <svg class="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 0112 0c0 5 2 6 2 6H4s2-1 2-6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 19a2 2 0 004 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                                    <span class="flex-1">Notifications</span>
                                </button>
                                <hr class="border-t border-border my-1" />
                                <!-- Log out -->
                                <button type="button" class="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-sm cursor-pointer border-none bg-transparent text-destructive hover:bg-destructive/10 text-left">
                                    <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none"><path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    <span class="flex-1">Log out</span>
                                </button>
                            `),
                        })}
                    </div>
                </section>

                <!-- NativeSelect + InputGroup -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">NativeSelect · InputGroup</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        <div class="w-48">
                            <span class="text-sm text-muted-foreground mb-2 block">Native select</span>
                            ${component(NativeSelect, {},
                                html`<option>United States</option><option>Vietnam</option><option>Germany</option>`)}
                        </div>
                        <div class="w-56 space-y-3">
                            <div>
                                <span class="text-sm text-muted-foreground mb-2 block">@username</span>
                                ${component(InputGroup, { prefix: '@', placeholder: 'username' })}
                            </div>
                            <div>
                                <span class="text-sm text-muted-foreground mb-2 block">Price</span>
                                ${component(InputGroup, { prefix: '$', suffix: 'USD', type: 'number', placeholder: '0.00' })}
                            </div>
                            <div>
                                <span class="text-sm text-muted-foreground mb-2 block">Website</span>
                                ${component(InputGroup, {
                                    prefix: html`<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
                                    placeholder: 'cossack.dev',
                                })}
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Item -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Item</h2>
                    <div class="border border-border rounded-lg divide-y divide-border max-w-sm">
                        ${component(Item, {
                            media: component(Avatar, { src: 'https://i.pravatar.cc/80?img=5', alt: 'Alice', size: 36 }),
                            trailing: component(Badge, { variant: 'primary' }, 'Admin'),
                            divider: false,
                        }, html`<div><p class="text-sm font-medium text-foreground">Alice Johnson</p><p class="text-xs text-muted-foreground">alice@cossack.dev</p></div>`)}
                        ${component(Item, {
                            media: component(Avatar, { src: 'https://i.pravatar.cc/80?img=8', alt: 'Bob', size: 36 }),
                            trailing: html`<svg class="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
                            divider: false,
                            interactive: true,
                        }, html`<div><p class="text-sm font-medium text-foreground">Bob Smith</p><p class="text-xs text-muted-foreground">bob@cossack.dev</p></div>`)}
                        ${component(Item, {
                            media: html`<span class="w-9 h-9 rounded-md bg-muted inline-flex items-center justify-center text-muted-foreground"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5"/></svg></span>`,
                            divider: false,
                        }, html`<div><p class="text-sm font-medium text-foreground">report.pdf</p><p class="text-xs text-muted-foreground">2.4 MB · 2 hours ago</p></div>`)}
                    </div>
                </section>

                <!-- Chat: Bubble · Message · MessageScroller · Marker · Attachment -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Chat — Bubble · Message · Attachment</h2>
                    <div class="border border-border rounded-lg overflow-hidden" style="height: 360px;">
                        ${component(MessageScroller, {},
                            html`
                                ${component(Marker, {}, 'Today')}
                                ${component(Message, {
                                    name: 'Alice',
                                    time: '10:30 AM',
                                    variant: 'received',
                                    avatar: component(Avatar, { src: 'https://i.pravatar.cc/80?img=5', alt: 'Alice', size: 28 }),
                                }, component(Bubble, {
                                    variant: 'received',
                                    reactions: [{ emoji: '👀', count: 2 }],
                                }, 'Hey! Did you see the new components?'))}
                                ${component(Bubble, {
                                    variant: 'sent',
                                    time: '10:31 AM',
                                    reactions: [{ emoji: '👍', count: 1 }, { emoji: '🎉' }],
                                }, 'Yes! They look great.')}
                                ${component(Message, {
                                    name: 'Alice',
                                    time: '10:32 AM',
                                    variant: 'received',
                                    avatar: component(Avatar, { src: 'https://i.pravatar.cc/80?img=5', alt: 'Alice', size: 28 }),
                                }, html`
                                    ${component(Bubble, { variant: 'received' }, 'I attached the design file.')}
                                    ${component(Attachment, { name: 'design-system.fig', size: '8.2 MB', type: 'file' })}
                                `)}
                                ${component(Bubble, {
                                    variant: 'sent',
                                    time: '10:33 AM',
                                    reactions: [{ emoji: '❤️', count: 3 }],
                                }, html`<img src="https://picsum.photos/200/120" class="rounded-lg" alt="" />`)}
                                ${component(Message, {
                                    name: 'Alice',
                                    time: '10:34 AM',
                                    variant: 'received',
                                    avatar: component(Avatar, { src: 'https://i.pravatar.cc/80?img=5', alt: 'Alice', size: 28 }),
                                }, component(Bubble, { variant: 'received' }, html`Nice! 🎉 Let me check it out.`))}
                            `)}
                    </div>
                </section>

                <!-- PasswordInput + MultiSelect -->
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">PasswordInput · MultiSelect</h2>
                    <div class="flex flex-wrap items-start gap-6">
                        <div class="w-56">
                            <span class="text-sm text-muted-foreground mb-2 block">Password (click the eye to reveal)</span>
                            ${component(PasswordInput, {
                                value: this.password,
                                placeholder: 'Enter password',
                                onChange: (v: string) => { this.password = v; },
                            })}
                        </div>
                        <div class="w-72">
                            <span class="text-sm text-muted-foreground mb-2 block">Skills (type to search or add new)</span>
                            ${component(MultiSelect, {
                                options: ['TypeScript', 'JavaScript', 'React', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Python', 'Go', 'Rust'],
                                value: this.skills,
                                placeholder: 'Add a skill...',
                                onChange: (v: string[]) => { this.skills = v; },
                            })}
                        </div>
                    </div>
                </section>

                <!-- Toaster (mount once — renders toasts from the global store) -->
                ${component(Toaster, {})}
            </div>
        `);
    }
}
