import { CossackElement, html } from '@cossackframework/renderer';
import type { ButtonAttributes, GlobalAttributes } from '@cossackframework/renderer/attributes';

export class Card extends CossackElement {
  declare props: GlobalAttributes<HTMLDivElement> & { hoverable?: boolean; padding?: 'none' | 'sm' | 'default' | 'lg' };
  render() {
    const { hoverable, padding, ...rest } = this.props;
    return html`<div class="card ${padding ?? 'default'}" ?data-hover=${!!hoverable} ...=${rest}>${this.children}</div>`;
  }
}

export class Button extends CossackElement {
  declare props: ButtonAttributes & { variant?: 'default' | 'ghost' };
  render() {
    const { variant = 'default', ...rest } = this.props;
    return html`<button class=${`btn ${variant}`} ...=${rest}>${this.children}</button>`;
  }
}

export class Counter extends CossackElement {
  declare props: { label: string; count?: number; onChange?: (count: number) => void };
  render() {
    return html`<output>${this.props.label}: ${this.props.count ?? 0}</output>`;
  }
}
