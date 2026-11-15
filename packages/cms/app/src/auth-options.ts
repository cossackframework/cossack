// The choices the shared sign-in pages and dashboard read. A project on the database ORM
// states them in src/dashboard.config.ts; the CMS has one answer: email and password
// (with passkeys and sign-in links, which its auth.ts adds), and every account screen.
export const authOptions = {
    authMethods: ['credentials'] as ('credentials' | 'oauth')[],
    oauth: [] as string[],
    modules: ['users', 'sessions', 'settings', 'roles'],
    dashboard: true,
    redirectAfterLogin: '/dashboard',
};
