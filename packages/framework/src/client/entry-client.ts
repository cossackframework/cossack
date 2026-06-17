import '../style.css';
import { createClientApp } from './';
import { enableDevTools } from './devtools';

if (import.meta.env.DEV) {
  enableDevTools();
}

createClientApp({ container: '#root', viewTransitions: true });