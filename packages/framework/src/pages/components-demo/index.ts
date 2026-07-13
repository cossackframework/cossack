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
    Icon,
} from '@cossackframework/ui';

@Page()
export class ComponentsDemo extends Cossack {
    @ClientState() modalOpen = false;
    @ClientState() sheetOpen = false;

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
                        ${component(AccordionItem, { open: true, summary: 'What is Cossack?' }, html`<p class="text-sm">A full-stack TypeScript framework for Cloudflare Workers and Node.js.</p>`)}
                        ${component(AccordionItem, { summary: 'Why native elements?' }, html`<p class="text-sm">They handle accessibility, keyboard, and form participation for free.</p>`)}
                        ${component(AccordionItem, { summary: 'Does this need JavaScript?' }, html`<p class="text-sm">No — the <code>&lt;details&gt;</code> element toggles natively.</p>`)}
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
                <section class="space-y-3">
                    <h2 class="text-lg font-semibold">Tabs</h2>
                    ${component(Tabs, {
                        items: [
                            { value: 'account', label: 'Account', content: html`<p class="text-sm">Account settings content.</p>` },
                            { value: 'password', label: 'Password', content: html`<p class="text-sm">Password settings content.</p>` },
                        ],
                    })}
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

                <!-- Toaster (mount once — renders toasts from the global store) -->
                ${component(Toaster, {})}
            </div>
        `);
    }
}
