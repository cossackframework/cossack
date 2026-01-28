import { CossackElement, html, component } from 'cossack-renderer';

// Refactor TodoItem to be a class component
export class TodoItem extends CossackElement {
    declare text: string;
    declare completed: boolean;
    declare onToggle: () => void;
    declare onRemove: () => void;

    static properties = {
        text: { state: true },
        completed: { state: true }
    };

    render() {
        return html`
        <li class="${this.completed ? 'completed' : ''}">
            <span @click="${this.onToggle}" style="text-decoration: ${this.completed ? 'line-through' : 'none'}">
                ${this.text}
            </span>
            <button @click="${this.onRemove}">x</button>
        </li>
        `;
    }
}

export class TodoApp extends CossackElement {
    static properties = {
        todos: { state: true },
        inputText: { state: true }
    };

    declare todos: { text: string, completed: boolean }[];
    declare inputText: string;

    constructor() {
        super();
        this.todos = [
            { text: 'Buy Milk', completed: false },
            { text: 'Walk the dog', completed: true }
        ];
        this.inputText = '';
    }

    addTodo() {
        console.log('addTodo called', this.inputText);
        if (!this.inputText) return;
        this.todos = [...this.todos, { text: this.inputText, completed: false }];
        this.inputText = '';
    }

    toggleTodo(index: number) {
        console.log('toggleTodo called', index);
        const newTodos = [...this.todos];
        newTodos[index] = { ...newTodos[index], completed: !newTodos[index].completed };
        this.todos = newTodos;
    }

    removeTodo(index: number) {
        console.log('removeTodo called', index);
        this.todos = this.todos.filter((_, i) => i !== index);
    }

    handleInput(e: Event) {
        const val = (e.target as HTMLInputElement).value;
        console.log('handleInput called', val);
        this.inputText = val;
    }

    render() {
        return html`
            <div class="todo-app">
                <h1>SSR Todo App (Composable)</h1>
                <div class="input-group">
                    <input type="text" .value="${this.inputText}" @input="${(e: Event) => this.handleInput(e)}" />
                    <button @click="${() => this.addTodo()}">Add</button>
                </div>
                <ul>
                    ${this.todos.map((item, index) => 
                        component(TodoItem, {
                            text: item.text,
                            completed: item.completed,
                            onToggle: () => this.toggleTodo(index),
                            onRemove: () => this.removeTodo(index)
                        })
                    )}
                </ul>
            </div>
        `;
    }
}