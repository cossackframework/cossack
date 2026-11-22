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

export default descriptor;
