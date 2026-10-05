import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPreviewSecrets } from '../src/preview-secrets.js';
it('loads only exact private staging secret names without exposing values in failures', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cossack-preview-secrets-'));
 const file=path.join(root,'staging.json');
 try {
  await fs.writeFile(file,JSON.stringify({APP_SECRET:'dummy-staging-only'}),{mode:0o600});
  expect(await readPreviewSecrets(root,file,['APP_SECRET'])).toEqual([{name:'APP_SECRET',type:'secret_text',text:'dummy-staging-only'}]);
  expect(await readPreviewSecrets(root,undefined,[])).toEqual([]);
  await expect(readPreviewSecrets(root,undefined,['APP_SECRET'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_REQUIRED'});
  await expect(readPreviewSecrets(root,file,['OTHER'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_NAMES_MISMATCH'});
  await expect(readPreviewSecrets(root,file,['APP_SECRET','APP_SECRET'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_DECLARATION_INVALID'});
  await expect(readPreviewSecrets(root,file,['__proto__'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_DECLARATION_INVALID'});
  await fs.symlink(file,path.join(root,'linked.json'));
  await expect(readPreviewSecrets(root,'linked.json',['APP_SECRET'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_FILE_INVALID'});
  if(process.platform!=='win32') { await fs.chmod(file,0o644); await expect(readPreviewSecrets(root,file,['APP_SECRET'])).rejects.toMatchObject({code:'COSSACK_PREVIEW_SECRETS_FILE_INVALID'}); await fs.chmod(file,0o600); }
  for(const value of ['dummy-sensitive-not-json','{"APP_SECRET":"dummy-sensitive-first","APP_SECRET":"dummy-sensitive-second"}',JSON.stringify({APP_SECRET:123}),JSON.stringify({APP_SECRET:''}),JSON.stringify({APP_SECRET:'a'.repeat(16385)}),JSON.stringify({APP_SECRET:'x',EXTRA:'dummy-sensitive'}),'x'.repeat(65537)]) {
   await fs.writeFile(file,value);
   try { await readPreviewSecrets(root,file,['APP_SECRET']); throw Error('Unexpected success'); } catch(error) { expect(error.code).toMatch(/^COSSACK_PREVIEW_SECRETS_/); expect(error.message).not.toContain('dummy-sensitive'); }
  }
 } finally { await fs.rm(root,{recursive:true,force:true}); }
});
