import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrivateAddressError, publicOnlyFetch } from '../src/node';
import { privateAddress, webhookUrlProblem } from '../src/webhooks';

describe('webhook addresses', () => {
    it('go to public HTTPS addresses, not this machine or a private network', () => {
        expect(webhookUrlProblem('https://hooks.example.com/cms')).toBeUndefined();
        for (const url of ['http://hooks.example.com/cms', 'http://localhost:3000/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://172.20.1.1/',
            'https://192.168.1.10/', 'https://169.254.169.254/latest/meta-data', 'https://100.64.0.1/', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/',
            'https://0x7f000001/', 'https://2130706433/', 'https://printer.local/', 'https://db.internal/']) expect(webhookUrlProblem(url), url).toBeDefined();
    });

    it('may stay on this machine or network while the site is in development', () => {
        for (const url of ['http://localhost:3000/x', 'http://127.0.0.1:8787/x', 'http://192.168.1.10/x', 'https://10.0.0.5/x', 'https://hooks.example.com/']) expect(webhookUrlProblem(url, { local: true }), url).toBeUndefined();
        expect(webhookUrlProblem('http://hooks.example.com/', { local: true })).toBeDefined();
        expect(webhookUrlProblem('ftp://localhost/', { local: true })).toBeDefined();
    });
});

describe('resolved webhook addresses', () => {
    let server: Server;
    let port: number;
    let hits = 0;
    beforeAll(async () => {
        server = createServer((_request, response) => { hits++; response.end('ok'); });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

    it('tells private addresses from public ones', () => {
        for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '0.0.0.0', '::1', '::', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', 'ff02::1']) expect(privateAddress(address), address).toBe(true);
        for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(privateAddress(address), address).toBe(false);
    });

    it('refuses to connect to a name that resolves to this machine', async () => {
        // localhost passes no name check at send time: only the resolved address gives it away.
        await expect(publicOnlyFetch(`http://localhost:${port}/hook`, { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(PrivateAddressError);
        await expect(publicOnlyFetch(`http://127.0.0.1:${port}/hook`)).rejects.toBeInstanceOf(PrivateAddressError);
        expect(hits).toBe(0);
    });
});
