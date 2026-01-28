import { renderToString, CossackElement, pushCurrentInstance, popCurrentInstance } from 'cossack-renderer';
import { App } from './main'; 

// Helper to render the app
export function renderApp() {
    const app = new App();
    
    // Simulate Root Context for SSR
    pushCurrentInstance(app);
    const template = app.render();
    let html = '';
    if (template) {
        html = renderToString(template);
    }
    popCurrentInstance();
    
    return html;
}

console.log(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Employee Management (SSR)</title>
    <style>
        body { font-family: sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f4f4f4; }
        .actions { display: flex; gap: 4px; }
        dialog { padding: 1rem; border: 1px solid #ccc; border-radius: 4px; min-width: 300px; }
        dialog::backdrop { background: rgba(0,0,0,0.5); }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; margin-bottom: 4px; }
        .form-group input { width: 100%; padding: 4px; box-sizing: border-box; }
        .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 1rem; }
        button { cursor: pointer; padding: 4px 8px; }
        .btn-primary { background: #007bff; color: white; border: none; }
        .btn-danger { background: #dc3545; color: white; border: none; }
    </style>
</head>
<body>
    <div id="app">${renderApp()}</div>
    <!-- No client script for pure SSR view, or add one if needed -->
</body>
</html>
`);