import { html, type TemplateResult } from '@cossackframework/renderer';
import { Cossack, Client, Page, Server, State } from '@cossackframework/core';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/Button';

interface Task {
    id: number;
    text: string;
}

@Page({
    channels: ['tasks'],
})
export class Tasks extends Cossack {
    @State({ channel: 'tasks' })
    private tasks: Task[] = [];

    @Server()
    async init() {
        // This runs on the server to initialize the state
        this.tasks = [
            { id: 1, text: 'Learn Cossack Framework' },
            { id: 2, text: 'Build a real-time app' },
            { id: 3, text: 'Deploy to Cloudflare Workers' },
        ];
    }

    @Server({ channel: 'tasks' })
    private async deleteTask(taskId: number, user: any) {
        console.log(`[Server] User ${user.id} is deleting task ${taskId}...`);
        
        // Simulate a delay for the database operation
        await new Promise(resolve => setTimeout(resolve, 1000));

        this.tasks = this.tasks.filter(task => task.id !== taskId);
        
        console.log(`[Server] Task ${taskId} deleted.`);

        // Call the client method directly!
        this.showAlert('Task was deleted successfully!');
    }

    @Client({ channel: 'tasks' })
    private showAlert(message: string) {
        alert(message);
    }

    private confirmDelete = (taskId: number) => {
        // This is a client-side only method, so we guard against SSR
        if (typeof window === 'undefined') return;

        if (window.confirm('Are you sure you want to delete this task?')) {
            // Manually set the loading state for the specific task
            this.loading = { ...this.loading, [`deleteTask_${taskId}`]: true };
            // The user argument is injected by the server, no need to pass it from the client.
            this.deleteTask(taskId);
        }
    }

    protected template(): TemplateResult {
        return Layout({
            dir: 'ltr',
        }, html`
            <div>
                <h1>Tasks</h1>
                <ul style="list-style: none; padding: 0;">
                    ${this.tasks.map(task => html`
                        <li style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <span>${task.text}</span>
                            ${Button({
                                '@click': () => this.confirmDelete(task.id),
                                '?disabled': this.loading[`deleteTask_${task.id}`],
                            }, 'Delete')}
                        </li>
                    `)}
                </ul>
            </div>
        `);
    }
}
