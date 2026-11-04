import { describe, expect, it } from 'vitest';
import { onFreePort } from '../src/testing';

describe('starting a test service on a free port', () => {
    const taken = new Error('RomeDB service did not start: Error: Os { code: 98, kind: AddrInUse, message: "Address already in use" }');

    it('tries another port when one is taken before the service binds it', async () => {
        const ports: number[] = [];
        const started = await onFreePort(async port => {
            ports.push(port);
            if (ports.length < 3) throw taken;
            return 'started';
        });
        expect(started).toBe('started');
        expect(ports).toHaveLength(3);
        expect(ports.every(port => port > 0)).toBe(true);
    });

    it('gives up after its attempts, and at once on any other failure', async () => {
        let attempts = 0;
        await expect(onFreePort(async () => { attempts++; throw taken; }, 3)).rejects.toThrow('Address already in use');
        expect(attempts).toBe(3);
        attempts = 0;
        await expect(onFreePort(async () => { attempts++; throw new Error('no such binary'); })).rejects.toThrow('no such binary');
        expect(attempts).toBe(1);
    });
});
