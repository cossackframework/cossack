import { describe, expect, it } from 'vitest';
import { numberPlaceholders, rqlDatabase, type RomeDB, type Statement } from '../src/index';

/** A binding stand-in that records each statement and answers with one empty result. */
function recording(fail?: (rql: string) => boolean) {
    const sent: string[] = [];
    const answer = async (statements: Statement[]) => {
        const rql = statements[0]!.rql;
        sent.push(rql);
        if (fail?.(rql)) throw new Error(`refused: ${rql}`);
        return { sequence: 1, results: [{ columns: ['n'], rows: [[1n]], affected: 1n }] };
    };
    return { sent, db: { read: answer, write: answer } as unknown as RomeDB };
}

describe('rqlDatabase', () => {
    it('numbers positional placeholders outside quoted text', () => {
        expect(numberPlaceholders("SELECT ? FROM t WHERE a = '?' AND b = ?")).toBe("SELECT $p1 FROM t WHERE a = '?' AND b = $p2");
    });

    it('creates its tables once, before the first statement', async () => {
        const { sent, db } = recording();
        const ledger = rqlDatabase(db, { schema: ['CREATE TABLE IF NOT EXISTS a (k TEXT PRIMARY KEY);\nCREATE INDEX IF NOT EXISTS a_k ON a(k);', 'CREATE TABLE IF NOT EXISTS b (k TEXT)'] });
        await Promise.all([ledger.prepare('SELECT 1').bind().first(), ledger.prepare('UPDATE a SET k = ?').bind('x').run()]);
        await ledger.prepare('SELECT 2').bind().all();
        expect(sent).toEqual([
            'CREATE TABLE IF NOT EXISTS a (k TEXT PRIMARY KEY)', 'CREATE INDEX IF NOT EXISTS a_k ON a(k)', 'CREATE TABLE IF NOT EXISTS b (k TEXT)',
            'SELECT 1', 'UPDATE a SET k = $p1', 'SELECT 2',
        ]);
    });

    it('runs the schema again after it failed', async () => {
        let refuse = true;
        const { sent, db } = recording(rql => refuse && rql.startsWith('CREATE'));
        const ledger = rqlDatabase(db, { schema: 'CREATE TABLE IF NOT EXISTS a (k TEXT)' });
        await expect(ledger.prepare('SELECT 1').bind().first()).rejects.toThrow(/refused/);
        refuse = false;
        await expect(ledger.prepare('SELECT 1').bind().first()).resolves.toEqual({ n: 1 });
        expect(sent).toEqual(['CREATE TABLE IF NOT EXISTS a (k TEXT)', 'CREATE TABLE IF NOT EXISTS a (k TEXT)', 'SELECT 1']);
    });
});
