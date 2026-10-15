import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FEATURE_REGISTRY, FEATURES } from '@cossackframework/scaffold/registry';
import { COMMANDS, printHelp } from '../src/dispatch.js';
import { COSSACK_PACKAGES } from '../src/installed-packages.js';
import { addHelp } from '../src/commands/add.js';
import { removeHelp } from '../src/commands/remove.js';
import { langHelp } from '../src/commands/lang.js';

vi.mock('../src/banner.js', () => ({ renderBanner: () => '' }));

describe('help lists features from the scaffold registry', () => {
  it.each([
    ['cossack --help', () => printHelp(true)],
    ['cossack add --help', addHelp],
    ['cossack remove --help', removeHelp],
  ])('%s names every feature', (_name, render) => {
    const help = render();
    for (const feature of FEATURES) expect(help).toMatch(new RegExp(`(?<![\\w-])${feature}(?![\\w-])`));
  });

  it('describes what add does, not only its usage line', () => {
    const help = addHelp();
    expect(help).toMatch(/prerequisite/i);
    expect(help).toMatch(/pnpm install/);
  });

  it('documents every feature and its direct prerequisites in docs/cossack-cli.md', () => {
    const docs = fs.readFileSync(fileURLToPath(new URL('../../../docs/cossack-cli.md', import.meta.url)), 'utf8');
    const rows = Object.fromEntries([...docs.matchAll(/^\| `([a-z-]+)` \| ((?:`[a-z-]+`(?:, )?)*) ?\|$/gm)]
      .map(([, feature, requires]) => [feature, [...requires.matchAll(/`([a-z-]+)`/g)].map(match => match[1])]));
    expect(rows).toEqual(Object.fromEntries(FEATURES.map(feature => [feature, FEATURE_REGISTRY[feature].requires])));
  });

  it('names every feature and command in the CLI package README', () => {
    const readme = fs.readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
    for (const feature of FEATURES) expect(readme, feature).toContain(`\`${feature}\``);
    for (const command of Object.keys(COMMANDS)) expect(readme, command).toMatch(new RegExp(`^\\| \`${command}[ \`]`, 'm'));
  });

  it('lists every documentation package in docs/local-agent-tools.md', () => {
    const docs = fs.readFileSync(fileURLToPath(new URL('../../../docs/local-agent-tools.md', import.meta.url)), 'utf8');
    const section = docs.slice(docs.indexOf('The allowed names are'), docs.indexOf('Without `package`'));
    expect([...section.matchAll(/`([^`]+)`/g)].map(match => match[1])).toEqual([...COSSACK_PACKAGES]);
  });

  it('lists every lang subcommand in the top-level help', () => {
    const help = printHelp(true);
    for (const subcommand of ['publish', 'add', 'extract', 'check', 'types']) expect(help).toContain(subcommand);
    expect(langHelp()).toContain('extract');
  });
});
