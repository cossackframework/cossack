export interface User {
    id: string;
    name: string;
    email: string;
    passwordHash: string;
    rememberToken: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}
