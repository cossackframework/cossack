#!/usr/bin/env node
import { startMcpServer } from '../src/mcp/server.js';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: cossack-mcp --project <directory>\nLocal read-only MCP server over stdio. No HTTP listener.');
} else if (args.length !== 2 || args[0] !== '--project' || !args[1]) {
  console.error('Usage: cossack-mcp --project <directory>');
  process.exitCode = 1;
} else {
  try {
    const server = await startMcpServer(args[1]);
    let closing;
    const close = () => closing ??= server.close();
    for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { void close(); });
    process.stdin.once('end', () => { void close(); });
    if (process.stdin.readableEnded) await close();
  } catch {
    console.error('COSSACK_MCP_START_FAILED: Provide an existing project directory with a valid package.json.');
    process.exitCode = 1;
  }
}
