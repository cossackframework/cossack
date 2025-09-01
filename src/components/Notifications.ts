import { State } from "@/shared/decorators"
import { html, type TemplateResult } from "@cossackframework/renderer"

// This is proposed to be used with @Live decorator
// to create a real-time notifications component
// that listens to a "notifications" channel
// and updates the UI when new notifications arrive.
@Live({
    channel: 'notifications',
})
export class Notifications {
    @State() notifications: any[] = []

    constructor(props: any) {}

    render() {
        return html`
            <div>
                ${this.notifications.map(notification => html`
                    <div class="notification">
                        ${notification.message}
                    </div>
                `)}
            </div>
        `
    }
}