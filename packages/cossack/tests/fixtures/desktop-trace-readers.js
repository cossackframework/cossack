import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function verifyDesktopTraceReaders(
  root,
  { snapshot, recorded },
  cliRoot = path.join(root, 'node_modules/cossack'),
) {
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [path.join(cliRoot, 'bin/cossack.js'), 'traces', '--json', '--session', snapshot.sessionId],
    { cwd: root, timeout: 15000 },
  );
  expect(JSON.parse(stdout)).toMatchObject({ ok: true, data: { record: recorded, freshness: { live: false } } });
  expect(stderr).toBe('');
  const client = new Client({ name: 'desktop-trace-acceptance', version: '1.0.0' });
  try {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(cliRoot, 'bin/cossack-mcp.js'), '--project', root],
      stderr: 'pipe',
    });
    let diagnostic = '';
    transport.stderr?.on('data', (data) => {
      diagnostic += data;
    });
    await client.connect(transport);
    const result = await client.callTool({
      name: 'read_development_traces',
      arguments: { session: snapshot.sessionId },
    });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { record: recorded, freshness: { live: false } },
    });
    expect(diagnostic).toBe('');
  } finally {
    await client.close();
  }
}
