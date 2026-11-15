import type { DashboardModule } from '../types';
import { MonitorSmartphoneIcon as iconSvg } from '@cossackframework/solar-icons/monitor-smartphone/line';

const icon = { line: iconSvg };

const descriptor: DashboardModule = {
  id: 'sessions',
  label: 'Sessions',
  href: '/dashboard/sessions',
  icon,
  authorization: 'authenticated',
  placement: 'account',
};

export default descriptor;
