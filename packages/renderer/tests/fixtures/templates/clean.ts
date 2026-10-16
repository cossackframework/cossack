import { CossackElement, bind, classMap, html, ifDefined, live, nothing, repeat, styleMap, svg, when, component } from '@cossackframework/renderer';
import { Button, Card, Counter } from './components';

interface Item { id: string; label: string; done: boolean }

export class Clean extends CossackElement {
  items: Item[] = [];
  name = '';
  url: string | undefined;
  open = false;
  count = 0;
  input = { value: undefined as HTMLInputElement | undefined };
  pick: typeof Card = Card;

  toggle(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    this.open = !this.open && event.currentTarget.isConnected;
  }

  render() {
    const icon = svg`<path d="M0 0h24v24H0z" fill="none" stroke-linecap="round" />`;
    return html`
      <main class=${classMap({ open: this.open })} style=${styleMap({ color: 'red' })} data-count=${this.count} aria-busy=${this.open}>
        <h1 title="Title &amp; more" tabindex="0" ?hidden=${!this.open}>${this.name}</h1>
        <a href=${ifDefined(this.url)} target="_blank" rel="noopener">Link</a>
        <img src="/a.png" alt="" width="24" height=${24} loading="lazy">
        <form method="POST" @submit=${(event: SubmitEvent) => event.preventDefault()} novalidate>
          <label for="name">Name</label>
          <input id="name" type="text" autocomplete="off" .value=${bind(this, 'name')} ?required=${this.open} ref=${this.input}>
          <input type="checkbox" .checked=${live(this.open)} @change=${(event: Event) => event.type}>
          <select .value=${this.name} @custom-picked=${(event: CustomEvent<string>) => event.detail}>
            ${repeat(this.items, (item) => item.id, (item) => html`<option value=${item.id} ?selected=${item.done}>${item.label}</option>`)}
          </select>
          <textarea rows="3" .value=${this.name}></textarea>
          <button type="submit" disabled @click=${this.toggle}>Save</button>
        </form>
        <table><tr><th scope="col" colspan="2">A</th></tr><tr><td colspan=${2}>${this.count}</td></tr></table>
        <svg viewBox="0 0 24 24" width="24" aria-hidden="true">${icon}<circle cx="12" cy="12" r=${4} /></svg>
        ${when(this.open, () => html`<p>Open</p>`, () => nothing)}
        <${Card} hoverable padding="sm" id="card" @click=${(event: MouseEvent) => event.button}>
          <${Button} variant="ghost" type="button" ?disabled=${this.open}>Save</${Button}>
          <${Counter} label="Count" count=${this.count} onChange=${(count: number) => { this.count = count; }} />
        </${Card}>
        ${component(this.pick, {})}
      </main>`;
  }
}
