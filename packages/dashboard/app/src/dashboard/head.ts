import type { HeadValue } from '@cossackframework/core';

/**
 * Meta tags every dashboard page carries beside its own, from the dashboard layout's head. The
 * application's are none; the CMS names its icon style and its palettes here.
 */
export function dashboardHead(): NonNullable<HeadValue['meta']> {
    return [];
}
