import { Cossack, Page, HeadContext, HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class ErrorPage extends Cossack {
    public head(context: HeadContext): HeadValue {
        return { title: 'Server Error' };
    }

    render() {
        return html`
            <div style="text-align: center; padding: 5rem 2rem; color: #d32f2f;">
                <h1 style="font-size: 3rem; margin-bottom: 1rem;">Something went wrong</h1>
                <p style="font-size: 1.2rem; margin-bottom: 2rem;">An unexpected error occurred while rendering this page.</p>
                <div style="text-align: left; background: #ffebee; padding: 1rem; border-radius: 4px; display: inline-block; max-width: 100%; overflow: auto;">
                    <p>Please try again later or contact support if the problem persists.</p>
                </div>
                <div style="margin-top: 2rem;">
                    <a href="/" style="color: #d32f2f; text-decoration: underline;">Return Home</a>
                </div>
            </div>
        `;
    }
}