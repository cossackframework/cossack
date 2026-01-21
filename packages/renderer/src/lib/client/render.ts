import { TemplateResult } from '../types';
import { TemplateInstance, getTemplate } from './parts';

export function render(result: TemplateResult, container: Element | DocumentFragment): void {
  if (typeof document === 'undefined') {
    throw new Error('DOM container provided, but no document available (e.g., not in browser)');
  }

  const extContainer: any = container;
  let templateInstance = extContainer._templateInstance as TemplateInstance | undefined;

  if (!templateInstance || templateInstance.template.strings !== result.strings) {
    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const template = getTemplate(result.strings);
    templateInstance = new TemplateInstance(template);
    extContainer._templateInstance = templateInstance;

    const fragment = templateInstance.clone();
    container.appendChild(fragment);
  }

  templateInstance.update(result.values);
}