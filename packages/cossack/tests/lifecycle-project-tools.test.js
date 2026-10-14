import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devCommand } from '../src/commands/dev.js';
import { ssgCommand } from '../src/commands/ssg.js';
import { startCommand } from '../src/commands/start.js';

let root;
let nested;
let originalPath;

/** A fake project-local tool that records how it was invoked. */
function installTool(name) {
  const directory = path.join(root, 'node_modules', name);
  fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '0.0.0', bin: { [name]: 'bin/cli.js' } }));
  fs.writeFileSync(path.join(directory, 'bin', 'cli.js'), `
    const fs = require('node:fs');
    const path = require('node:path');
    fs.writeFileSync(path.join(__dirname, '..', 'invocation.json'), JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
  `);
}

const invocation = name => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'invocation.json'), 'utf8'));

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cossack-lifecycle-')));
  nested = path.join(root, 'src', 'pages');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', cossack: { runtime: 'cloudflare' } }));
  installTool('vite');
  installTool('wrangler');
  // Nothing may be resolved from PATH: a globally installed CLI has no project tools there.
  originalPath = process.env.PATH;
  process.env.PATH = path.join(root, 'empty-path');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  process.env.PATH = originalPath;
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('lifecycle commands run project-installed tools', () => {
  it('dev runs the project vite from the project root', async () => {
    expect(await devCommand(['--port', '4000'], { cwd: nested, flags: { json: true } })).toBe(0);
    expect(invocation('vite')).toEqual({ argv: ['dev', '--port', '4000'], cwd: root });
  });

  it('ssg runs the project vite build from the project root', async () => {
    expect(await ssgCommand([], { cwd: nested, flags: { json: true } })).toBe(0);
    expect(invocation('vite')).toEqual({ argv: ['build'], cwd: root });
  });

  it('ssg without --json also uses the project vite', async () => {
    expect(await ssgCommand([], { cwd: nested, flags: {} })).toBe(0);
    expect(invocation('vite')).toEqual({ argv: ['build'], cwd: root });
  });

  it('start runs the project wrangler for Cloudflare projects', async () => {
    expect(await startCommand([], { cwd: nested, flags: { json: true } })).toBe(0);
    expect(invocation('wrangler')).toEqual({ argv: ['dev'], cwd: root });
    expect(await startCommand(['--port', '9000'], { cwd: nested, flags: {} })).toBe(0);
    expect(invocation('wrangler')).toEqual({ argv: ['dev', '--port', '9000'], cwd: root });
  });

  it('reports a missing project tool clearly', async () => {
    fs.rmSync(path.join(root, 'node_modules', 'vite'), { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await devCommand([], { cwd: nested, flags: { json: true } })).toBe(1);
  });
});
