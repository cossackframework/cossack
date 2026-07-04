export interface User {
    id: string;
    name: string;
    email: string;
    password: string;
    rememberToken: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}
