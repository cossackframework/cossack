import { html } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    Client,
    ClientState,
    ClientTask,
    createRef,
    type RefObject,
} from "@cossackframework/core";

export interface MessageScrollerProps {
    /** Label for the "new messages" affordance button. */
    newMessageLabel?: string;
    /** Threshold in px from the bottom to consider "at bottom". Default 80. */
    threshold?: number;
    [key: string]: any;
}

/**
 * Cossack UI MessageScroller — scroll container that sticks to the bottom.
 *
 * Automatically scrolls to bottom on mount and when new content arrives — but
 * only if the user was already at (or near) the bottom. If the user scrolled
 * up to read history, a floating "new messages" button appears to jump back.
 *
 *   ${component(MessageScroller, {},
 *       html\`${messages.map(m => component(Message, {...}, component(Bubble, {...}, m.text)))}\`)}
 */
@Component()
export class MessageScroller extends Cossack {
    declare props: MessageScrollerProps;

    scrollRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
    @ClientState() private atBottom = true;
    @ClientState() private showJumpButton = false;
    private prevScrollHeight = 0;

    render() {
        const { newMessageLabel = "New messages ↓" } = this.props;

        return html`
            <div class="cs-message-scroller relative h-full">
                <div
                    ref=${this.scrollRef}
                    class="cs-message-scroller__viewport h-full overflow-y-auto"
                    @scroll=${() => this.handleScroll()}
                >
                    <div class="cs-message-scroller__content flex flex-col gap-3 p-4">
                        ${this.children}
                    </div>
                </div>
                ${this.showJumpButton
                    ? html`<button
                          type="button"
                          class="cs-message-scroller__jump absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 text-sm font-medium rounded-full bg-background border border-border shadow-lg cursor-pointer hover:bg-muted transition-colors z-10"
                          @click=${() => this.scrollToBottom()}
                      >${newMessageLabel}</button>`
                    : null}
            </div>
        `;
    }

    onMount() {
        // Stick to bottom on initial load.
        requestAnimationFrame(() => this.scrollToBottom());
    }

    /** If content grew and we were at the bottom, keep sticking. Client-only. */
    @ClientTask()
    private stickToBottom() {
        const vp = this.scrollRef.value;
        if (!vp) return;
        const grew = vp.scrollHeight > this.prevScrollHeight;
        if (grew && this.atBottom) {
            requestAnimationFrame(() => this.scrollToBottom());
        }
        this.prevScrollHeight = vp.scrollHeight;
    }

    @Client()
    private handleScroll() {
        const vp = this.scrollRef.value;
        if (!vp) return;
        const threshold = this.props.threshold ?? 80;
        const distanceFromBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
        const isAtBottom = distanceFromBottom <= threshold;
        this.atBottom = isAtBottom;
        this.showJumpButton = !isAtBottom && vp.scrollHeight > vp.clientHeight + threshold;
    }

    @Client()
    private scrollToBottom() {
        const vp = this.scrollRef.value;
        if (!vp) return;
        vp.scrollTop = vp.scrollHeight;
        this.atBottom = true;
        this.showJumpButton = false;
    }
}
