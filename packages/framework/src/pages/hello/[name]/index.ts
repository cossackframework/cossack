import type { MiddlewareHandler } from 'hono';
import { Button } from '../../../components/Button';
import { Layout } from '../../../components/Layout';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack, isServer, Page, Server, State } from '@cossackframework/core';

// Example middleware
const loggingMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        console.log('Executing logging middleware...');
    }
    await next();
};

@Page({
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

    protected template(): TemplateResult {
        const isFeedLoading = this.loading['incrementFeed'];
        const isNotificationLoading = this.loading['incrementNotifications'];

        return Layout({
            dir: 'ltr',
        }, html`
            <div>
                <h1>${this.greeting}</h1>
                
                <div class="counters" style="margin: 20px 0;">
                    <p>Feeds Count: <strong>${this.feedCount}</strong></p>
                    <p>Notifications Count: <strong>${this.notificationCount}</strong></p>
                </div>

                <div class="buttons" style="display: flex; gap: 10px;">
                    ${Button({                    
                        '@click': this.incrementFeed,
                        'disabled': isFeedLoading,
                    }, html`${isFeedLoading ? 'Updating Feeds...' : 'Increment Feeds'}`)}
                    
                    ${Button({                    
                        '@click': this.incrementNotifications,
                        'disabled': isNotificationLoading,
                    }, html`${isNotificationLoading ? 'Updating Notifications...' : 'Increment Notifications'}`)}
                </div>
            </div>
        `);
    }
}