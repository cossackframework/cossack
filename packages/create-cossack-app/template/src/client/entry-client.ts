import '../style.css';
import { createClientApp } from '@cossackframework/framework/client/app';
import { App } from '../App';

createClientApp({ container: '#root', AppComponent: App });
