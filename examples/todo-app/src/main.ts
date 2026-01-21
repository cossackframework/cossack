import { Component, CossackElement, State, Prop, html } from '@cossackframework/renderer';

@Component({ tag: 'app-header' })
export class AppHeader extends CossackElement {
  render() {
    return html`
      <header style="background: #eee; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
        <h1 style="margin: 0; color: #333;">Cossack Todo</h1>
        <p style="margin: 0; color: #666; font-size: 0.9em;">Optimized with Flattening</p>
      </header>
    `;
  }
}

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

@Component({ tag: 'todo-item' })
export class TodoItem extends CossackElement {
  @Prop() todo!: Todo;
  @Prop() onToggle!: () => void;
  @Prop() onDelete!: () => void;

  render() {
    return html`
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <label style="display: flex; align-items: center; gap: 0.5rem; flex: 1;">
          <input 
            type="checkbox" 
            .checked=${this.todo.completed} 
            @change=${this.onToggle}
          />
          <span class="${this.todo.completed ? 'completed' : ''}">${this.todo.text}</span>
        </label>
        <button @click=${this.onDelete}>
          Delete
        </button>
      </div>
    `;
  }
}

@Component({ tag: 'todo-app' })
export class TodoApp extends CossackElement {
  @State() todos: Todo[] = [
    { id: 1, text: 'Learn Cossack Renderer', completed: true },
    { id: 2, text: 'Build a Todo App', completed: false }
  ];

  @State() inputText = '';

  addTodo(e: Event) {
    e.preventDefault();
    if (!this.inputText.trim()) return;

    this.todos = [
      ...this.todos,
      { id: Date.now(), text: this.inputText, completed: false }
    ];
    this.inputText = '';
  }

  toggleTodo(id: number) {
    this.todos = this.todos.map(t => 
      t.id === id ? { ...t, completed: !t.completed } : t
    );
  }

  deleteTodo(id: number) {
    this.todos = this.todos.filter(t => t.id !== id);
  }

  handleInput(e: Event) {
    this.inputText = (e.target as HTMLInputElement).value;
  }

  render() {
    return html`
      <c:app-header></c:app-header>
      
      <form @submit=${(e: Event) => this.addTodo(e)} style="margin-bottom: 2rem; display: flex; gap: 0.5rem;">
        <input 
          type="text" 
          .value=${this.inputText} 
          @input=${(e: Event) => this.handleInput(e)}
          placeholder="What needs to be done?" 
          style="flex: 1; padding: 0.5rem;"
        />
        <button type="submit" style="padding: 0.5rem 1rem;">Add</button>
      </form>

      <div>
        ${this.todos.map(todo => html`
          <c:todo-item 
            .todo=${todo}
            .onToggle=${() => this.toggleTodo(todo.id)}
            .onDelete=${() => this.deleteTodo(todo.id)}
          ></c:todo-item>
        `)}
      </div>

      ${this.todos.length === 0 ? html`<p style="text-align: center; color: #888;">No items yet!</p>` : ''}
    `;
  }
}
