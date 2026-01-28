import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Cossack, Client, Page, Server, State, OnEvent, HeadTag, HeadContext, HeadValue } from '@cossackframework/core';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/Button';

interface Task {
    id: number;
    text: string;
}

@Page({
    transport: 'durable-object',
    channels: ['tasks'],
})
export class Tasks extends Cossack {
    @State({ channel: 'tasks' })
    private tasks: Task[] = [];

    public head(context: HeadContext): HeadValue {
        return {
            title: 'Task List'
        };
    }

    @Server()
    async init() {
        // This runs on the server to initialize the state, but only if it's not already populated.
        if (this.tasks.length === 0) {
            this.tasks = [
                { id: 1, text: 'Learn Cossack Framework' },
                { id: 2, text: 'Build a real-time app' },
                { id: 3, text: 'Deploy to Cloudflare Workers' },
            ];
        }
    }

    @Server({ channel: 'tasks' })
    private async deleteTask(taskId: number) {
        // Simulate a delay for the database operation
        await new Promise(resolve => setTimeout(resolve, 1000));

        // In a real app, you would delete from the database here.
        this.tasks = this.tasks.filter(task => task.id !== taskId);

        console.log(`[Server] Task ${taskId} deleted.`);

        // Broadcast an event instead of pushing state
        this.broadcastEvent('tasks:changed');

        // Call the client method directly!
        this.showAlert('Task was deleted successfully!');
    }

    @OnEvent('tasks:changed')
    private async onTasksChanged() {
        console.log('[Client] Detected tasks change event, re-initializing state.');
        await this.init();
    }

    @Client({ channel: 'tasks' })
    private showAlert(message: string) {
        alert(message);
    }

    private confirmDelete = (taskId: number) => {
        if (window.confirm('Are you sure you want to delete this task?')) {
            // Manually set the loading state for the specific task
            this.loading = { ...this.loading, [`deleteTask_${taskId}`]: 1 };
            // The user argument is injected by the server, no need to pass it from the client.
            this.deleteTask(taskId);
        }
    }

    render(): TemplateResult {
        return component(Layout, {
            dir: 'ltr',
        }, html`
            <div>
                <h1>Tasks</h1>
                <ul style="list-style: none; padding: 0;">
                    ${this.tasks.map(task => html`
                        <li style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <span>${task.text}</span>
                            ${component(Button, {
            '@click': () => this.confirmDelete(task.id),
            '?disabled': !!this.loading[`deleteTask_${task.id}`],
        }, 'Delete')}
                        </li>
                    `)}
                </ul>
            </div>
        `);
    }
}
