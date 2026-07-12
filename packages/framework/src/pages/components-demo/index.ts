import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
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
    Icon,
} from '@cossackframework/ui';

@Page()
export class ComponentsDemo extends Cossack {
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
            </div>
        `);
    }
}
