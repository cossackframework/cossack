import { Cossack, Page, State } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';

/**
 * Dynamic SSG Example with generateStaticParams
 *
 * This page demonstrates how to use SSG with dynamic routes.
 * The generateStaticParams function returns the list of parameter
 * combinations to pre-render at build time.
 *
 * Usage:
 *   @Page({
 *     ssg: {
 *       enabled: true,
 *       generateStaticParams: async () => {
 *         return [{ username: 'alice' }, { username: 'bob' }];
 *       }
 *     }
 *   })
 */
@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      // Example: Generate static pages for predefined users
      // In a real application, this could fetch from a database
      return [
        { username: 'alice' },
        { username: 'bob' },
        { username: 'charlie' },
      ];
    }
  },
  transport: 'http'
})
export class UserProfile extends Cossack {
  @State() username: string = '';

  head() {
    return {
      title: `User Profile - ${this.username}`,
      description: `User profile page for ${this.username}`
    };
  }

  render() {
    // Get the username from route params
    const name = this.c.req.param('username') || this.username || 'Guest';

    return html`
        <div class="user-profile">
          <h1>User Profile</h1>

          <div class="profile-card">
            <div class="avatar">
              ${name.charAt(0).toUpperCase()}
            </div>
            <div class="user-info">
              <h2>@${name}</h2>
              <p>This is a pre-rendered profile page for <strong>${name}</strong>.</p>
            </div>
          </div>

          <div class="info-card">
            <h3>How It Works</h3>
            <p>
              This page uses dynamic SSG with <code>generateStaticParams</code>.
              At build time, Cossack generates a static HTML file for each
              username returned by the function.
            </p>
          </div>

          <div class="code-example">
            <h3>Code Example</h3>
            <pre><code>@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      return [
        { username: 'alice' },
        { username: 'bob' },
        { username: 'charlie' },
      ];
    }
  }
})
export class UserProfile extends Cossack {
  @State() username: string = '';

  render() {
    const name = this.c.req.param('username');
    return html\`<h1>Hello \${name}!</h1>\`;
  }
}</code></pre>
          </div>

          <div class="build-info">
            <p>Pre-rendered at build time for username: <strong>${name}</strong></p>
            <p>Build date: ${new Date().toISOString()}</p>
          </div>
        </div>
    `;
  }
}
