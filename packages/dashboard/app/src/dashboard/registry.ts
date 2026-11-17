import type { DashboardModule } from './types';
import { authOptions } from '../auth-options';
import users from './modules/users';
import sessions from './modules/sessions';
import settings from './modules/settings';
import roles from './modules/roles';
import { Widget4Icon } from '@cossackframework/solar-icons/widget-4/line';

const modules: Record<string, DashboardModule> = { users, sessions, settings, roles };

/**
 * The modules the project chose (src/dashboard.config.ts: `modules`), in this order, then the
 * project's own screens (`navigation`).
 */
export const dashboardModules: DashboardModule[] = [
    ...Object.entries(modules).filter(([id]) => (authOptions.modules as readonly string[]).includes(id)).map(([, module]) => module),
    ...authOptions.navigation.map((item): DashboardModule => ({ ...item, icon: item.icon ?? { line: Widget4Icon }, authorization: item.authorization ?? 'authenticated' })),
];
