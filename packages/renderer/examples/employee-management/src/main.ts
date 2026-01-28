import { CossackElement, html, repeat, live, ref } from 'cossack-renderer';

interface Employee {
    id: number;
    name: string;
    role: string;
    email: string;
}

// --- Components ---

class ConfirmDialog extends CossackElement {
    static properties = {
        open: { state: true },
        title: { state: true },
        message: { state: true }
    };

    declare open: boolean;
    declare title: string;
    declare message: string;
    declare onconfirm: () => void;
    declare oncancel: () => void;

    private dialogRef?: HTMLDialogElement;

    constructor() {
        super();
        this.open = false;
        this.title = 'Confirm';
        this.message = 'Are you sure?';
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('open') && this.dialogRef) {
            if (this.open && !this.dialogRef.open) {
                this.dialogRef.showModal();
            } else if (!this.open && this.dialogRef.open) {
                this.dialogRef.close();
            }
        }
    }

    render() {
        return html`
            <dialog ref="${(el: HTMLDialogElement) => this.dialogRef = el}">
                <h3>${this.title}</h3>
                <p>${this.message}</p>
                <div class="dialog-actions">
                    <button @click="${() => this.oncancel()}">Cancel</button>
                    <button class="btn-danger" @click="${() => this.onconfirm()}">Confirm</button>
                </div>
            </dialog>
        `;
    }
}

class EmployeeFormDialog extends CossackElement {
    static properties = {
        open: { state: true },
        employee: { state: true }
    };

    declare open: boolean;
    declare employee: Employee | null; 
    declare onsave: (emp: Omit<Employee, 'id'>) => void;
    declare oncancel: () => void;

    private dialogRef?: HTMLDialogElement;
    private formData: Omit<Employee, 'id'> = { name: '', role: '', email: '' };

    constructor() {
        super();
        this.open = false;
        this.employee = null;
    }

    willUpdate(changed: Map<string, unknown>) {
        if (changed.has('employee')) {
            if (this.employee) {
                this.formData = { ...this.employee };
            } else {
                this.formData = { name: '', role: '', email: '' };
            }
        }
    }

    updated(changed: Map<string, unknown>) {
        if (changed.has('open') && this.dialogRef) {
            if (this.open && !this.dialogRef.open) {
                this.dialogRef.showModal();
            } else if (!this.open && this.dialogRef.open) {
                this.dialogRef.close();
            }
        }
    }

    handleInput(field: keyof Omit<Employee, 'id'>, value: string) {
        this.formData[field] = value;
    }

    save() {
        this.onsave(this.formData);
    }

    render() {
        const title = this.employee ? 'Edit Employee' : 'Add Employee';
        return html`
            <dialog ref="${(el: HTMLDialogElement) => this.dialogRef = el}">
                <h3>${title}</h3>
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" 
                        .value="${live(this.formData.name)}" 
                        @input="${(e: any) => this.handleInput('name', e.target.value)}" />
                </div>
                <div class="form-group">
                    <label>Role</label>
                    <input type="text" 
                        .value="${live(this.formData.role)}" 
                        @input="${(e: any) => this.handleInput('role', e.target.value)}" />
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" 
                        .value="${live(this.formData.email)}" 
                        @input="${(e: any) => this.handleInput('email', e.target.value)}" />
                </div>
                <div class="dialog-actions">
                    <button @click="${() => this.oncancel()}">Cancel</button>
                    <button class="btn-primary" @click="${() => this.save()}">Save</button>
                </div>
            </dialog>
        `;
    }
}

export class App extends CossackElement {
    static properties = {
        employees: { state: true },
        formOpen: { state: true },
        confirmOpen: { state: true }
    };
    
    static components = { EmployeeFormDialog, ConfirmDialog };

    declare employees: Employee[];
    declare formOpen: boolean;
    declare confirmOpen: boolean;
    
    private editingId: number | null = null;
    private deletingId: number | null = null;

    constructor() {
        super();
        this.employees = [
            { id: 1, name: 'John Doe', role: 'Developer', email: 'john@example.com' },
            { id: 2, name: 'Jane Smith', role: 'Designer', email: 'jane@example.com' }
        ];
        this.formOpen = false;
        this.confirmOpen = false;
    }

    openCreate() {
        this.editingId = null;
        this.formOpen = true;
    }

    openEdit(id: number) {
        this.editingId = id;
        this.formOpen = true;
    }

    openDelete(id: number) {
        this.deletingId = id;
        this.confirmOpen = true;
    }

    handleSave(data: Omit<Employee, 'id'>) {
        if (this.editingId) {
            this.employees = this.employees.map(e => e.id === this.editingId ? { ...data, id: this.editingId! } : e);
        } else {
            const newId = Math.max(0, ...this.employees.map(e => e.id)) + 1;
            this.employees = [...this.employees, { ...data, id: newId }];
        }
        this.formOpen = false;
    }

    handleDelete() {
        if (this.deletingId) {
            this.employees = this.employees.filter(e => e.id !== this.deletingId);
        }
        this.confirmOpen = false;
    }

    render() {
        const editingEmployee = this.employees.find(e => e.id === this.editingId) || null;

        return html`
            <div>
                <header style="display:flex; justify-content:space-between; align-items:center;">
                    <h1>Employee Management</h1>
                    <button class="btn-primary" @click="${() => this.openCreate()}">Add Employee</button>
                </header>

                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Email</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${repeat(this.employees, (e) => e.id, (e) => html`
                            <tr>
                                <td>${e.name}</td>
                                <td>${e.role}</td>
                                <td>${e.email}</td>
                                <td class="actions">
                                    <button @click="${() => this.openEdit(e.id)}">Edit</button>
                                    <button class="btn-danger" @click="${() => this.openDelete(e.id)}">Delete</button>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>

                <c:EmployeeFormDialog
                    .open="${this.formOpen}"
                    .employee="${editingEmployee}"
                    .onsave="${(data: any) => this.handleSave(data)}"
                    .oncancel="${() => this.formOpen = false}"
                ></c:EmployeeFormDialog>

                <c:ConfirmDialog
                    .open="${this.confirmOpen}"
                    title="Delete Employee"
                    message="Are you sure you want to delete this employee?"
                    .onconfirm="${() => this.handleDelete()}"
                    .oncancel="${() => this.confirmOpen = false}"
                ></c:ConfirmDialog>
            </div>
        `;
    }
}

if (typeof document !== 'undefined') {
    const root = document.getElementById('app');
    if (root) {
        const app = new App();
        app.mount(root);
    }
}
