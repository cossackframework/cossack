import { createStore } from '@cossackframework/core';
import type { StudioSchema } from '../../src/lib/schema-types';

/**
 * Browser-memory catalog shared by every Monaco instance. Keeping this outside
 * the page component means completion providers can read the freshest schema
 * after DDL without rebuilding the editor.
 */
export const studioSchemaCatalog = createStore<StudioSchema | null>(null);
