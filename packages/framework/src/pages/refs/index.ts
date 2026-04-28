import { Cossack, Page, Ref, State, html, type RefObject } from '@cossackframework/core';

@Page()
export default class RefPage extends Cossack {

    @Ref()
    declare inputRef: RefObject<HTMLInputElement>;

    @Ref()
    declare boxRef: RefObject<HTMLDivElement>;

    @State()
    status: string = 'Waiting for input...';

    onMount() {
        // Slight delay to ensure browser is ready for focus
        setTimeout(() => {
            this.inputRef.value?.focus();
            this.status = 'Input focused via Ref!';
        }, 50);

        // Refs are set after render completes, so check in a timeout
        setTimeout(() => {
            if (this.boxRef.value) {
                this.boxRef.value.style.border = '2px solid green';
            }
        }, 100);
    }

    animateBox = () => {
        if (this.boxRef.value) {
            this.boxRef.value.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(1.2)' },
                { transform: 'scale(1)' }
            ], {
                duration: 500
            });
            this.status = 'Box animated via direct DOM access!';
        }
    };

    render() {
        return html`
            <div class="p-4 font-sans">
                <h1 class="text-2xl font-bold mb-4">Refs Demo</h1>

                <p class="status text-gray-500 mb-4">${this.status}</p>

                <div class="flex gap-4 items-center mb-4">
                    <input
                        type="text"
                        ref=${this.inputRef}
                        class="border border-gray-300 p-2 rounded"
                        placeholder="I was focused automatically"
                    />

                    <button
                        @click=${this.animateBox}
                        class="bg-blue-500 text-white px-4 py-2 border-none rounded cursor-pointer"
                    >
                        Animate Box
                    </button>
                </div>

                <div
                    ref=${this.boxRef}
                    class="target-box w-32 h-32 bg-blue-100 rounded flex items-center justify-center transition-colors duration-300"
                >
                    Target Box
                </div>
            </div>
        `;
    }
}
