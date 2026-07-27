import '../style.css';
import { App } from '../App.js';
import { createClientApp } from './index.js';

if (import.meta.env.DEV) {
  void import('./devtools.js').then(({ enableDevTools }) => enableDevTools());
}

createClientApp({ container: '#root', AppComponent: App, viewTransitions: true, progressBar: true });
