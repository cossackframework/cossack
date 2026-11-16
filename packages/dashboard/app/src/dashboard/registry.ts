import type { DashboardModule } from './types';
import { authOptions } from '../auth-options';
import users from './modules/users';
import sessions from './modules/sessions';
import settings from './modules/settings';
import roles from './modules/roles';

const modules: Record<string, DashboardModule> = { users, sessions, settings, roles };

/** The modules the project chose (src/dashboard.config.ts: `modules`), in this order. */
export const dashboardModules: DashboardModule[] = Object.entries(modules)
    .filter(([id]) => (authOptions.modules as readonly string[]).includes(id))
    .map(([, module]) => module);
