import type { MiddlewareHandler } from 'hono';
import { Button } from '@/components/Button';
import { Layout } from '@/components/Layout';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack } from '@/shared/cossack';
import { isServer } from '@/shared/environment';
import { Page, Server, State, Computed } from '@/shared/decorators';

// Example middleware
const loggingMiddleware: MiddlewareHandler = async (c, next) => {
    if (isServer) {
        console.log('Executing logging middleware...');
    }
    await next();
};

@Page({
    middlewares: [loggingMiddleware],
    channels: [
        'feeds',
        'notifications',
    ],
})
export class Greeting extends Cossack {
    // State for the 'feeds' channel
    @State({ channel: 'feeds' })
    private feedCount: number = 0;

    // State for the 'notifications' channel
    @State({ channel: 'notifications' })
    private notificationCount: number = 0;

    // State for the default 'global' channel
    @State()
    private name: string = 'World';

    @Server() // Runs on the 'global' channel by default
    async init() {
        // Simulate a data fetch
        await new Promise(resolve => setTimeout(resolve, 50));
        this.name = 'Cossack';
        this.feedCount = 1;
        this.notificationCount = 5;
    }

    @Computed()
    private get message(): string {
        return `Hello ${this.name}!`;
    }

    // Action associated with the 'feeds' channel
    @Server({ channel: 'feeds' })
    private incrementFeed = async (user: any) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        this.feedCount++;
        console.log(`User ${user.id} incremented feeds to ${this.feedCount}`);
    };

    // Action associated with the 'notifications' channel
    @Server({ channel: 'notifications' })
    private incrementNotifications = async (user: any) => {
        await new Promise(resolve => setTimeout(resolve, 100));
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
                <h1>${this.message}</h1>
                
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
