// src/pages/api/rate-limited/index.ts
//
// Demonstrates the RateLimit handler wrapper on a functional API route.
// Each caller (by user id, else IP) is capped at 3 requests per 10 seconds.
import { RateLimit } from '@cossackframework/core';

export const GET = RateLimit({ window: 10_000, max: 3 }, (c: any) => {
    return c.json({ success: true, message: 'Allowed within rate limit' });
});
