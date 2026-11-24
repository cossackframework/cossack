import type { DashboardModule } from '../types';
import { UsersGroupRoundedIcon as iconSvg } from '@cossackframework/solar-icons/users-group-rounded/line';

const icon = { line: iconSvg };

const descriptor: DashboardModule = {
  id: 'users',
  label: 'Users',
  href: '/dashboard/users',
  icon,
  authorization: 'admin',
  children: [
    { label: 'All users', href: '/dashboard/users' },
    { label: 'Add user', href: '/dashboard/users/new' },
    { label: 'Registrations', href: '/dashboard/users/registrations' },
  ],
};

export default descriptor;
