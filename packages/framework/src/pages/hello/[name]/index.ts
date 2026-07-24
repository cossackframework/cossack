import type { MiddlewareHandler } from 'hono';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack, isServer, Page, Server, State, HeadTag, HeadContext, HeadValue } from '@cossackframework/core';
import { Button } from '@cossackframework/ui';

// Example middleware
const loggingMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        console.log('Executing logging middleware...');
    }
    await next();
};

@Page({
    transport: 'durable-object',
    stateful: true,
    middlewares: [loggingMiddleware],
    channels: ['feeds', 'notifications'],
})
export class Greeting extends Cossack {
    // 3. Use the typed decorators. `channel` now autocompletes and is type-checked.
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    // @State({ channel: 'invalid-channel' }) // <-- This would now cause a compile-time TypeScript error.
    // private invalidState: number = 0;

    @State() // 'global' is always a valid channel.
    private greeting: string = '';

    @Server()
    async init() {
        // 4. Access route parameters from `this.c`.
        this.greeting = `Hello ${this.c?.req.param('name')}!`;
        this.feedCount = 1;
        this.notificationCount = 5;
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: `Hello ${this.c.req.param('name')}`
        };
    }

    @Server({ channel: 'feeds' })
    private incrementFeed = async (user: any) => {
        this.feedCount++;
        console.log(`User ${user.id} incremented feeds to ${this.feedCount}`);
    };

    @Server({ channel: 'notifications' })
    private incrementNotifications = async (user: any) => {
        this.notificationCount++;
        console.log(`User ${user.id} incremented notifications to ${this.notificationCount}`);
    };

    render() {
        const isFeedLoading = this.loading['incrementFeed'];
        const isNotificationLoading = this.loading['incrementNotifications'];

        return html`
                <div>
                    <h1>${this.greeting}</h1>
                    
                    <div class="counters my-5">
                        <p>Feeds Count: <strong>${this.feedCount}</strong></p>
                        <p>Notifications Count: <strong>${this.notificationCount}</strong></p>
                    </div>

                    <div class="buttons flex gap-2.5">
                        ${component(Button, {
                            '@click': this.incrementFeed,
                            disabled: !!isFeedLoading,
                            children: isFeedLoading ? 'Updating Feeds...' : 'Increment Feeds'
                        }, 'Increment Feeds')}

                        ${component(Button, {
                            '@click': this.incrementNotifications,
                            disabled: !!isNotificationLoading
                        }, isNotificationLoading ? 'Updating Notifications...' : 'Increment Notifications')}
                    </div>
                </div>
        `;
    }
}
