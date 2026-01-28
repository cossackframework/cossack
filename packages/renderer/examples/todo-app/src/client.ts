import { TodoApp } from './components';

const container = document.getElementById('app');
if (container) {
    const app = new TodoApp();
    app.mount(container);
    console.log('App hydrated!');
}