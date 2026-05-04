import type { MiddlewareHandler } from 'hono';
import { Button } from '@/components/Button';
import { html, type TemplateResult, component, classMap } from '@cossackframework/renderer';
import { Cossack, isServer, Page, Server, State, HeadTag, HeadContext, HeadValue } from '@cossackframework/core';

@Page()
export class CSSClassDemo extends Cossack {
   
    render(): TemplateResult {
        const backgroundClass = 'bg-red-500';
        const dynamicClasses = classMap({
            'bg-red-500': true,
            'h-[100px]': true,
            'w-[100px]': true,
        });

        return html`
            <h1>CSS Class Demo</h1>
            
            <div class="flex">
                <!-- This is working at SSR time, but not at CSR time -->
                <div class="h-[100px] w-[100px] ${backgroundClass}"></div>
                
                <!-- This is working at both SSR and CSR time -->
                <div class="${dynamicClasses}"></div>
            </div>
        `;
    }
}