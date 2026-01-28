import { renderToString } from 'cossack-renderer';
import { TodoApp } from './components';

export function renderApp() {
    const app = new TodoApp();
    const template = app.render();
    if (!template) return '';
    return renderToString(template);
}

console.log(`
<!DOCTYPE html>
<html>
<head>
    <title>CRP Todo App</title>
</head>
<body>
    <div id="app">${renderApp()}</div>
</body>
</html>
`);
