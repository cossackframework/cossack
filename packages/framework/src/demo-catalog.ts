import type { IconEntry } from '@cossackframework/ui';
import { HomeIcon } from '@cossackframework/solar-icons/home';
import { LockIcon } from '@cossackframework/solar-icons/lock';
import { Widget2Icon } from '@cossackframework/solar-icons/widget-2';
import { PenNewSquareIcon } from '@cossackframework/solar-icons/pen-new-square';
import { DatabaseIcon } from '@cossackframework/solar-icons/database';
import { RefreshCircleIcon } from '@cossackframework/solar-icons/refresh-circle';
import { Routing2Icon } from '@cossackframework/solar-icons/routing-2';
import { ServerIcon } from '@cossackframework/solar-icons/server';
import { DocumentTextIcon } from '@cossackframework/solar-icons/document-text';

export const DEMO_CATEGORIES = [
  'Overview',
  'Authentication',
  'UI & Blocks',
  'Forms & Validation',
  'State & Data Flow',
  'Lifecycle & Reactivity',
  'Rendering & Navigation',
  'Platform & Server',
  'Documentation',
] as const;

export type DemoCategory = (typeof DEMO_CATEGORIES)[number];

export interface DemoCatalogEntry {
  label: string;
  url: string;
  category: DemoCategory;
  icon?: IconEntry;
}

export interface DemoCatalogGroup {
  category: DemoCategory;
  icon?: IconEntry;
  entries: readonly DemoCatalogEntry[];
}

const categoryIcons: Record<DemoCategory, IconEntry> = {
  Overview: HomeIcon,
  Authentication: LockIcon,
  'UI & Blocks': Widget2Icon,
  'Forms & Validation': PenNewSquareIcon,
  'State & Data Flow': DatabaseIcon,
  'Lifecycle & Reactivity': RefreshCircleIcon,
  'Rendering & Navigation': Routing2Icon,
  'Platform & Server': ServerIcon,
  Documentation: DocumentTextIcon,
};

const entries: readonly DemoCatalogEntry[] = [
  { label: 'Demo overview', url: '/', category: 'Overview' },
  { label: 'Contact and flash messages', url: '/contact', category: 'Overview' },

  { label: 'Sign in', url: '/login', category: 'Authentication' },
  { label: 'Register', url: '/register', category: 'Authentication' },

  { label: 'Component gallery', url: '/components-demo', category: 'UI & Blocks' },
  { label: 'Block gallery', url: '/blocks', category: 'UI & Blocks' },
  { label: 'Login block', url: '/blocks/login', category: 'UI & Blocks' },
  { label: 'Dashboard block', url: '/blocks/dashboard', category: 'UI & Blocks' },
  { label: 'Settings block', url: '/blocks/settings', category: 'UI & Blocks' },
  { label: 'Command palette block', url: '/blocks/command-palette', category: 'UI & Blocks' },

  { label: 'Progressive forms', url: '/forms', category: 'Forms & Validation' },
  { label: 'Basic state form', url: '/forms/basic-state', category: 'Forms & Validation' },
  { label: 'Complex form', url: '/forms/complex-form', category: 'Forms & Validation' },
  { label: 'Validation', url: '/validation', category: 'Forms & Validation' },
  { label: 'Nested store validation', url: '/store-validation', category: 'Forms & Validation' },

  { label: 'HTTP counter', url: '/counter-http', category: 'State & Data Flow' },
  { label: 'Optimistic counter', url: '/optimistic-counter', category: 'State & Data Flow' },
  { label: 'Stateless counter', url: '/stateless-counter', category: 'State & Data Flow' },
  { label: 'Nested state', url: '/examples/nested-state', category: 'State & Data Flow' },
  { label: 'Tasks', url: '/tasks', category: 'State & Data Flow' },
  { label: 'Task tracker', url: '/task-tracker', category: 'State & Data Flow' },
  { label: 'Dependency injection', url: '/di-demo', category: 'State & Data Flow' },
  { label: 'Scoped dependency injection', url: '/di-demo/other', category: 'State & Data Flow' },
  { label: 'Server-sent events chat', url: '/sse-chat', category: 'State & Data Flow' },

  { label: 'Lifecycle and loading', url: '/lifecycle', category: 'Lifecycle & Reactivity' },
  { label: 'Debounce and throttle', url: '/debounce', category: 'Lifecycle & Reactivity' },
  { label: 'Events', url: '/events', category: 'Lifecycle & Reactivity' },
  { label: 'DOM refs', url: '/refs', category: 'Lifecycle & Reactivity' },

  { label: 'Dynamic hello route', url: '/hello/Cossack', category: 'Rendering & Navigation' },
  { label: 'Renderer directives', url: '/renderer/directives', category: 'Rendering & Navigation' },
  { label: 'Lit compatibility', url: '/renderer/lit-compat', category: 'Rendering & Navigation' },
  { label: 'View transitions', url: '/view-transitions', category: 'Rendering & Navigation' },
  { label: 'View transition detail', url: '/view-transitions/1', category: 'Rendering & Navigation' },
  { label: 'Prevent navigation', url: '/prevent-navigation', category: 'Rendering & Navigation' },
  { label: 'Localization', url: '/localization-demo', category: 'Rendering & Navigation' },
  { label: 'Image optimization', url: '/image-demo', category: 'Rendering & Navigation' },
  { label: 'Tailwind CSS', url: '/tailwind-demo', category: 'Rendering & Navigation' },
  { label: 'CSS class rendering', url: '/css-class-demo', category: 'Rendering & Navigation' },

  { label: 'Application config', url: '/config-demo', category: 'Platform & Server' },
  { label: 'Cache', url: '/examples/cache', category: 'Platform & Server' },
  { label: 'Request context', url: '/examples/context-demo', category: 'Platform & Server' },
  { label: 'Server functions', url: '/examples/server-functions', category: 'Platform & Server' },
  { label: 'Client-only modules', url: '/examples/client-only-modules', category: 'Platform & Server' },
  { label: 'Security and code stripping', url: '/security-demo', category: 'Platform & Server' },
  { label: 'R2 uploads', url: '/r2-upload', category: 'Platform & Server' },
  { label: 'Static site generation', url: '/ssg-demo', category: 'Platform & Server' },
  { label: 'Generated user page', url: '/ssg-demo/users/demo', category: 'Platform & Server' },

  { label: 'Documentation', url: '/docs', category: 'Documentation' },
  { label: 'Hello documentation', url: '/docs/hello', category: 'Documentation' },
] as const;

export const demoCatalog: readonly DemoCatalogGroup[] = DEMO_CATEGORIES.map((category) => ({
  category,
  icon: categoryIcons[category],
  entries: entries.filter((entry) => entry.category === category),
}));

export const demoEntries: readonly DemoCatalogEntry[] = demoCatalog.flatMap((group) => group.entries);

export const demoCommandItems = demoEntries.map((entry) => ({
  id: entry.url,
  label: entry.label,
  group: entry.category,
}));
