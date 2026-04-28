import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ErrorPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Server Error' };
    }

    render() {
        return html`
            <div class="text-center py-20 px-8 text-red-700">
                <h1 class="text-[3rem] mb-4">Something went wrong</h1>
                <p class="text-xl mb-8">An unexpected error occurred while rendering this page.</p>
                <div class="text-left bg-red-50 p-4 rounded inline-block max-w-full overflow-auto">
                    <p>Please try again later or contact support if the problem persists.</p>
                </div>
                <div class="mt-8">
                    <a href="/" class="text-red-700 underline">Return Home</a>
                </div>
            </div>
        `;
    }
}
