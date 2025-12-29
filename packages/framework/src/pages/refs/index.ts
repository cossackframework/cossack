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
            console.log('Focusing input via ref:', this.inputRef.value);
            this.inputRef.value?.focus();
            this.status = 'Input focused via Ref!';
        }, 50);
        
        if (this.boxRef.value) {
            this.boxRef.value.style.border = '2px solid green';
        }
    }

    animateBox() {
        if (this.boxRef.value) {
            this.boxRef.value.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(1.2)' },
                { transform: 'scale(1)' }
            ], {
                duration: 500
            });
            // Update status only if it changes to avoid unnecessary re-renders
            if (this.status !== 'Box animated via direct DOM access!') {
                this.status = 'Box animated via direct DOM access!';
            }
        }
    }

    render() {
        return html`
            <style>
                .container { padding: 16px; font-family: sans-serif; }
                .title { font-size: 24px; font-weight: bold; margin-bottom: 16px; }
                .status { color: #666; margin-bottom: 16px; }
                .controls { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; }
                .input { border: 1px solid #ccc; padding: 8px; border-radius: 4px; }
                .btn { background-color: #3b82f6; color: white; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
                .target-box { 
                    width: 128px; height: 128px; 
                    background-color: #dbeafe; 
                    border-radius: 4px; 
                    display: flex; align-items: center; justify-content: center; 
                    transition: background-color 0.3s;
                }
            </style>
            <div class="container">
                <h1 class="title">Refs Demo</h1>
                
                <p class="status">${this.status}</p>

                <div class="controls">
                    <input 
                        type="text" 
                        ref=${this.inputRef} 
                        class="input"
                        placeholder="I was focused automatically"
                    />
                    
                    <button 
                        @click=${this.animateBox}
                        class="btn"
                    >
                        Animate Box
                    </button>
                </div>

                <div 
                    ref=${this.boxRef}
                    class="target-box"
                >
                    Target Box
                </div>
            </div>
        `;
    }
}
