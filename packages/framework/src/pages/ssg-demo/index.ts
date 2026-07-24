import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';

/**
 * Static SSG Example
 *
 * This page is pre-rendered at build time using SSG.
 * Mark the page with ssg: true to enable static generation.
 *
 * Usage:
 *   @Page({ ssg: true })
 */
@Page({ ssg: true, transport: 'http' })
export class SsgDemo extends Cossack {
  head() {
    return {
      title: 'SSG Demo - Static Page',
      description: 'This page demonstrates static site generation with the ssg option'
    };
  }

  render() {
    return html`
        <div class="ssg-demo">
          <h1>Static Site Generation Demo</h1>

          <div class="info-card">
            <h2>About This Page</h2>
            <p>
              This page was <strong>pre-rendered at build time</strong> using
              Cossack's Static Site Generation (SSG) feature. When you build
              your application with <code>pnpm run build:ssg</code>, this page
              is rendered to a static HTML file.
            </p>
          </div>

          <div class="features">
            <h2>SSG Features</h2>
            <ul>
              <li>Pre-rendered HTML for faster page loads</li>
              <li>Better SEO with crawlable content</li>
              <li>Can be hosted on any static hosting service</li>
              <li>Reduced server-side computation</li>
            </ul>
          </div>

          <div class="code-example">
            <h2>Usage</h2>
            <pre><code>import { Cossack, Page } from '@cossackframework/core';

@Page({ ssg: true })
export class MyPage extends Cossack {
  render() {
    return html\`<h1>Hello World</h1>\`;
  }
}</code></pre>
          </div>

          <p class="build-info">
            Build date: ${new Date().toISOString()}
          </p>
        </div>
    `;
  }
}
