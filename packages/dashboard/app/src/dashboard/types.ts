import type { IconEntry } from '@cossackframework/solar-icons/types';

export interface DashboardModuleLink {
  label: string;
  href: string;
}

export interface DashboardModule {
  id: string;
  label: string;
  href: string;
  icon: IconEntry;
  /** Who sees the module: any signed-in user, administrators, or holders of a permission. */
  authorization: 'authenticated' | 'admin' | { permission: string };
  placement?: 'navigation' | 'account';
  children?: DashboardModuleLink[];
  /** Another module whose menu lists this one's links, after its own, when the user sees both. */
  parent?: string;
  /** Highlighted on every page under this path, such as `/dashboard/settings` for screens with their own navigation. */
  activeFor?: string;
}

/** A status the dashboard's taskbar shows: what waits for the user, and where to go. */
export interface DashboardStatus {
  id: string;
  label: string;
  href: string;
  /** How many, shown beside the label; omitted for a plain link. */
  count?: number;
  tone?: 'info' | 'warning' | 'error';
}

/** A message above every dashboard screen, such as one a CMS plugin returns. */
export interface DashboardNotice {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
  /** A same-site path the notice links to. */
  href?: string;
}
