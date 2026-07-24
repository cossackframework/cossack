import 'reflect-metadata';
import { createApp } from '@cossackframework/framework/router';
import { App } from './App';
import { template } from './root';

export const app = createApp({ AppComponent: App, htmlTemplate: template });
