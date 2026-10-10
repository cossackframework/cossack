import { Client, ClientState, Cossack, Page, server$ } from '@cossackframework/core';
import { html, repeat } from '@cossackframework/renderer';

interface Product { id: string; name: string; category: string }

/** Read-only data: replace the loader with your service or selected database. */
@Page({ transport: 'http' })
export default class ResourcePage extends Cossack<any, { Resources: 'products' }> {
  @ClientState() category = 'all';

  products = server$(async (category: string): Promise<Product[]> => {
    // Validate public inputs on the server even when the UI uses a select.
    if (!['all', 'books', 'tools', 'other'].includes(category)) throw new Error('Invalid category');
    const catalog: Product[] = [
      { id: 'guide', name: 'Framework guide', category: 'books' },
      { id: 'notebook', name: 'Project notebook', category: 'tools' },
    ];
    return category === 'all' ? catalog : catalog.filter(product => product.category === category);
  }, { deps: () => [this.category] as const, initial: [] as Product[] });

  @Client()
  changeCategory(event: Event) {
    this.category = (event.currentTarget as HTMLSelectElement).value;
  }

  @Client()
  async refreshProducts() {
    await this.refresh$('products');
  }

  render() {
    // Reading the resource starts its loader before asking for lifecycle state.
    const products = this.products;
    const status = this.resourceStatus$('products');
    return html`
      <main>
        <h1>Read-only resource</h1>
        <label for="resource-category">Category</label>
        <select id="resource-category" .value=${this.category} @change=${this.changeCategory}>
          <option value="all">All</option>
          <option value="books">Books</option>
          <option value="tools">Tools</option>
          <option value="other">Other</option>
        </select>
        <button type="button" @click=${this.refreshProducts} ?disabled=${status.state === 'pending'}>
          ${status.state === 'error' ? 'Retry' : 'Refresh'}
        </button>
        ${status.state === 'pending' ? html`<p role="status">${status.stale ? 'Updating results…' : 'Loading results…'}</p>` : ''}
        ${status.state === 'error' ? html`<p role="alert">Could not load products. Retry to try again.</p>` : ''}
        ${status.state === 'ready' && products.length === 0 ? html`<p>No products in this category.</p>` : ''}
        <ul aria-busy=${status.state === 'pending'}>
          ${repeat(products, product => product.id, product => html`<li>${product.name}</li>`)}
        </ul>
      </main>
    `;
  }
}
