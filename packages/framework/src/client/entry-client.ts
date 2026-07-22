import '../style.css';
import { createClientApp } from './index.js';
import { enableDevTools } from './devtools.js';

if (import.meta.env.DEV) {
  enableDevTools();
}

createClientApp({ container: '#root', viewTransitions: true, progressBar: true });
