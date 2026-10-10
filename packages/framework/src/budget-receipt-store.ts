/** Private atomic storage for invocation-signed budget receipts. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const BUDGET_RUN_ENV = 'COSSACK_BUILD_BUDGET_RUN_ID';
export const budgetHash = (text: string) => createHash('sha256').update(text).digest('hex');
export const validBudgetKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(key);
const filename = 'build-budget-receipt.json';
const receiptPath = (root: string) => path.join(root, '.cossack', filename);
async function directory(root: string) {
  const dir = path.join(root, '.cossack');
  try { await mkdir(dir); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('Budget receipt storage must be a regular project directory.'), { code: 'COSSACK_BUILD_BUDGET_RECEIPT_UNSAFE' });
  return dir;
}
export async function clearBudgetReceipt(root: string) { await directory(root); await rm(receiptPath(root), { force: true }); }
export async function prepareBudgetRun(root: string) { await clearBudgetReceipt(root); return randomUUID(); }
export async function writeSignedBudgetReceipt(root: string, key: string, body: Record<string, unknown>) {
  const signature = createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
  const temporary = path.join(await directory(root), `${filename}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, JSON.stringify({ ...body, signature }), { mode: 0o600, flag: 'wx' }); await rename(temporary, receiptPath(root)); }
  finally { await rm(temporary, { force: true }); }
}
export async function readSignedBudgetReceipt(root: string, key: string, version: number): Promise<Record<string, any> | undefined> {
  try {
    if (!validBudgetKey(key)) return;
    const dir = await lstat(path.join(root, '.cossack')); const stat = await lstat(receiptPath(root));
    if (!dir.isDirectory() || dir.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return;
    const { signature, ...body } = JSON.parse(await readFile(receiptPath(root), 'utf8'));
    if (typeof signature !== 'string' || !/^[a-f\d]{64}$/.test(signature)) return;
    const expected = createHmac('sha256', key).update(JSON.stringify(body)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')) || body.version !== version || body.run !== budgetHash(key)) return;
    return body;
  } catch { return undefined; }
}
