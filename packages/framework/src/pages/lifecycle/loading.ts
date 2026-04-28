import { Cossack, html } from '@cossackframework/core';

/**
 * QuickSkeleton - Loading state component
 *
 * This component follows the Cossack loading convention:
 * - When a user navigates to /lifecycle, the framework first looks for loading.ts
 * - If found, it displays this component immediately (instant visual feedback)
 * - Meanwhile, the page component is fetched from the server
 * - Once the page loads, this loading component is replaced with the actual page
 *
 * This provides a better UX than a blank page or browser spinner during navigation.
 */
export default class QuickSkeleton extends Cossack {
    render() {
        return html`
            <div class="p-5 border-2 border-dashed border-gray-300 rounded-xl bg-slate-50 animate-pulse">
                <h2>Loading Page... (Convention)</h2>
                <p>This UI is coming from <code>loading.ts</code> and is shown instantly upon navigation.</p>
                <div class="bg-gray-200 h-5 my-3 rounded-md" style="width: 85%"></div>
                <div class="bg-gray-200 h-5 my-3 rounded-md" style="width: 70%"></div>
                <div class="bg-gray-200 h-5 my-3 rounded-md" style="width: 95%"></div>
                <div class="bg-gray-200 h-5 my-3 rounded-md" style="width: 50%"></div>
            </div>
        `;
    }
}
