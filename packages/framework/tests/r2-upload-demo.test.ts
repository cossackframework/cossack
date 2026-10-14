import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Storage } from '@cossackframework/core/storage';
import { authorizeR2UploadDemo, R2_UPLOAD_DEMO_CONTENT_TYPES, R2_UPLOAD_DEMO_MAX_BYTES } from '../src/pages/r2-upload/index';

const key = 'r2-upload-demo/123e4567-e89b-42d3-a456-426614174000.png';

describe('r2-upload demo storage policy', () => {
  it('allows uploads of server-generated keys under the demo prefix only', () => {
    expect(authorizeR2UploadDemo({ context: undefined, operation: 'put', key })).toBe(true);
    for (const rejected of ['secrets/123e4567-e89b-42d3-a456-426614174000.png', 'index.html', 'r2-upload-demo/../x.png',
      'r2-upload-demo/chosen-by-client.png', 'other/r2-upload-demo/123e4567-e89b-42d3-a456-426614174000.png']) {
      expect(authorizeR2UploadDemo({ context: undefined, operation: 'put', key: rejected })).toBe(false);
    }
    for (const operation of ['get', 'head', 'delete'] as const) expect(authorizeR2UploadDemo({ context: undefined, operation, key })).toBe(false);
  });

  it('rejects out-of-prefix keys, oversize bodies and disallowed types through the facade', async () => {
    const provider = { name: 'memory', put: vi.fn(), get: vi.fn(), head: vi.fn(), delete: vi.fn() };
    const storage = new Storage<unknown>({ provider, authorize: authorizeR2UploadDemo, maxBytes: R2_UPLOAD_DEMO_MAX_BYTES,
      contentTypes: Object.keys(R2_UPLOAD_DEMO_CONTENT_TYPES), signing: { secret: 'x'.repeat(32), endpoint: 'https://app.example/r2-upload' } });
    await expect(storage.signedUrl(undefined, 'index.html', 'put', { expiresIn: 60, size: 1, contentType: 'image/png' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_FORBIDDEN' });
    await expect(storage.signedUrl(undefined, key, 'put', { expiresIn: 60, size: R2_UPLOAD_DEMO_MAX_BYTES + 1, contentType: 'image/png' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_SIZE_INVALID' });
    await expect(storage.signedUrl(undefined, key, 'put', { expiresIn: 60, size: 1, contentType: 'text/html' })).rejects.toMatchObject({ code: 'COSSACK_STORAGE_TYPE_INVALID' });
    expect(await storage.signedUrl(undefined, key, 'put', { expiresIn: 60, size: 1, contentType: 'image/png' })).toMatch(/^https:\/\/app\.example\/r2-upload\?access=/);
    expect(provider.put).not.toHaveBeenCalled();
  });
});
