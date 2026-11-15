// src/lib/uuid.ts
//
// UUIDv7 for every row id: time-sortable, which keeps indexes compact. It comes from the
// framework core, the same generator the CMS uses. Never use one as a secret; its time is
// readable. Tokens take crypto.getRandomValues().
export { uuidv7 } from '@cossackframework/core';
