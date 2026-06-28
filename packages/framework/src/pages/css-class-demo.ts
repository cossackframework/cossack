import { Cossack, Page } from '@cossackframework/core';
import { classMap, html, type TemplateResult } from '@cossackframework/renderer';

@Page()
export class CSSClassDemo extends Cossack {
   
    render(): TemplateResult {
        const backgroundClass = 'bg-red-500';
        const dynamicClasses = classMap({
            'bg-red-500': true,
            'h-25': true,
            'w-25': true,
        });

        return html`
            <h1>CSS Class Demo</h1>
            
            <div class="flex">
                <!-- This is working at SSR time, but not at CSR time -->
                <div class="h-25 w-25 ${backgroundClass}"></div>
                
                <!-- This is working at both SSR and CSR time -->
                <div class="${dynamicClasses}"></div>
            </div>
        `;
    }
}