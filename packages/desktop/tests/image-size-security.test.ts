import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { imageSizeFromFile } from 'image-size/fromFile';
import { expect, it } from 'vitest';

it('rejects zero-length ICNS entries without looping during installer image inspection', () => {
  const modulePath = createRequire(import.meta.url).resolve('image-size');
  // A child deadline keeps a vulnerable parser from hanging the test runner.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { imageSize } = require(${JSON.stringify(modulePath)});
    const icon = Buffer.alloc(16);
    icon.write('icns', 0);
    icon.writeUInt32BE(16, 4);
    icon.write('ic07', 8);
    assert.throws(() => imageSize(icon), /Invalid ICNS/);
  `], { timeout: 5000, stdio: 'pipe' });
});

it('reads DMG background dimensions with the asynchronous image-size 2 API', async () => {
  const filename = fileURLToPath(new URL('../../scaffold/template/desktop-assets/icon-512.png', import.meta.url));
  await expect(imageSizeFromFile(filename)).resolves.toMatchObject({ width: 512, height: 512, type: 'png' });
  await expect(imageSizeFromFile(`${filename}.missing`)).rejects.toMatchObject({ code: 'ENOENT' });
});
