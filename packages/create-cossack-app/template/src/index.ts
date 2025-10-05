import { Hono } from 'hono';
import { cossack } from '@cossackframework/framework';

const app = new Hono();

app.all('*', cossack());

export default app;
