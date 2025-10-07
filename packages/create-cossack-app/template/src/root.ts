import { Cossack } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

export class Root extends Cossack {
  render() {
    return html`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Cossack App</title>
          <link rel="stylesheet" href="/style.css" />
        </head>
        <body>
          <div id="root">${this.page}</div>
          <script type="module" src="/client/entry-client.ts"></script>
        </body>
      </html>
    `;
  }
}