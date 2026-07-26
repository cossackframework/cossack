import '../style.css';
import { App } from '../App.js';
import { createClientApp } from './index.js';
import { enableDevTools } from './devtools.js';

if (import.meta.env.DEV) {
  enableDevTools();
}

createClientApp({ container: '#root', AppComponent: App, viewTransitions: true, progressBar: true });
