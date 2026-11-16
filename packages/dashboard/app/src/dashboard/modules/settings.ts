import type { DashboardModule } from '../types';
import { UserCircleIcon as iconSvg } from '@cossackframework/solar-icons/user-circle/line';

const icon = { line: iconSvg };

const descriptor: DashboardModule = {
  id: 'settings',
  label: 'Profile settings',
  href: '/dashboard/profile',
  icon,
  authorization: 'authenticated',
  placement: 'account',
};

export default descriptor;
