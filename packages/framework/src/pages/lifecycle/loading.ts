import { Cossack, html } from '@cossackframework/core';

export default class QuickSkeleton extends Cossack {
    render() {
        return html`
            <style>
                .loading-shell { 
                    padding: 20px; 
                    border: 2px dashed #cbd5e1; 
                    border-radius: 12px; 
                    background: #f8fafc;
                    animation: pulse 1.5s infinite;
                }
                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
                .skeleton-line { background: #e2e8f0; height: 20px; margin: 12px 0; border-radius: 6px; }
            </style>
            <div class="loading-shell">
                <h2>Loading Page... (Convention)</h2>
                <p>This UI is coming from <code>loading.ts</code> and is shown instantly upon navigation.</p>
                <div class="skeleton-line" style="width: 85%"></div>
                <div class="skeleton-line" style="width: 70%"></div>
                <div class="skeleton-line" style="width: 95%"></div>
                <div class="skeleton-line" style="width: 50%"></div>
            </div>
        `;
    }
}