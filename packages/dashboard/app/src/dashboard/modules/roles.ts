import type { DashboardModule } from '../types';
import { ShieldKeyholeIcon as iconSvg } from '@cossackframework/solar-icons/shield-keyhole/line';

const icon = { line: iconSvg };

const descriptor: DashboardModule = {
  id: 'roles',
  label: 'Roles',
  href: '/dashboard/roles',
  icon,
  authorization: 'admin',
  parent: 'users',
};

export default descriptor;
