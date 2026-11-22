import type { DashboardModule } from '../types';
import { Buildings2Icon as iconSvg } from '@cossackframework/solar-icons/buildings-2/line';

const icon = { line: iconSvg };

/** The list of tenants, on the main host while tenants are on (src/dashboard.config.ts). */
const descriptor: DashboardModule = {
  id: 'tenants',
  label: 'Tenants',
  href: '/dashboard/tenants',
  icon,
  authorization: 'admin',
};

/** Your tenants: the ones an account belongs to, and making one while registration is on. */
export const myTenants: DashboardModule = {
  id: 'my-tenants',
  label: 'Your tenants',
  href: '/dashboard/tenants/register',
  icon,
  authorization: 'authenticated',
};

export default descriptor;
