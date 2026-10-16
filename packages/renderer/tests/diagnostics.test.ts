import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript-api';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkTemplates, findTemplates, type TemplateDiagnostic } from '../src/diagnostics';

const root = path.join(import.meta.dirname, 'fixtures/templates');
let program: ts.Program;

const check = (relative: string, options?: Parameters<typeof checkTemplates>[3]): TemplateDiagnostic[] =>
  checkTemplates(ts, program, program.getSourceFile(path.join(root, relative))!, options);

beforeAll(() => {
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  program = ts.createProgram(parsed.fileNames, parsed.options);
}, 60_000);

describe('template diagnostics', () => {
  it('passes the clean fixture', () => {
    expect(check('clean.ts').filter((diagnostic) => diagnostic.severity !== 'hint')).toEqual([]);
    expect(check('components.ts')).toEqual([]);
  });

  const defects = readdirSync(path.join(root, 'defects')).filter((file) => file.endsWith('.ts')).sort();

  it.each(defects)('fails defects/%s with file, line and column', (file) => {
    const source = readFileSync(path.join(root, 'defects', file), 'utf8');
    const code = source.match(/^\/\/ (COSSACK_TEMPLATE_[A-Z_]+):/)![1];
    const line = source.split('\n').findIndex((text) => text.includes('// defect')) + 1;
    const errors = check(`defects/${file}`).filter((diagnostic) => diagnostic.severity === 'error');
    expect(errors.map((error) => error.code)).toEqual([code]);
    const [error] = errors;
    expect(error.file).toBe(path.join(root, 'defects', file));
    expect(error.line).toBe(line);
    expect(error.column).toBeGreaterThan(1);
    // The column points into the line, at the reported text.
    const lineText = source.split('\n')[line - 1];
    expect(error.column).toBeLessThanOrEqual(lineText.length);
    expect(source.slice(error.start, error.start + error.length).length).toBe(error.length);
  });

  it('points at the exact source text', () => {
    const [unknown] = check('defects/unknown-attribute.ts');
    expect(unknown).toMatchObject({ line: 5, column: 11, length: 'colour'.length });
    const [handler] = check('defects/event-handler.ts');
    const source = readFileSync(path.join(root, 'defects/event-handler.ts'), 'utf8');
    expect(source.slice(handler.start, handler.start + handler.length)).toBe('onKey');
    expect(handler.message).toContain('KeyboardEvent');
  });

  it('runs structural rules without types', () => {
    expect(check('defects/self-closing-element.ts', { types: false }).map((diagnostic) => diagnostic.code))
      .toEqual(['COSSACK_TEMPLATE_SELF_CLOSING_ELEMENT']);
    expect(check('defects/unknown-attribute.ts', { types: false })).toEqual([]);
  });

  it('maps positions through escapes and CRLF line endings', () => {
    const text = 'const v = html`<p>\\u0041</p>\r\n<b colour="1">x</b>`;';
    const sourceFile = ts.createSourceFile('/virtual.ts', text, ts.ScriptTarget.Latest, true);
    const [template] = findTemplates(ts, sourceFile);
    const bold = template.parsed.nodes.find((node) => node.type === 'element' && node.tag === 'b');
    if (bold?.type !== 'element') throw new Error('expected <b>');
    const start = template.position(bold.attributes[0].nameRange.start);
    expect(text.slice(start, start + 'colour'.length)).toBe('colour');
  });
});

/** Check one virtual file against the fixture program's options and components. */
const checkText = (name: string, text: string) => {
  const file = path.join(root, name);
  const host = ts.createCompilerHost(program.getCompilerOptions());
  const read = host.getSourceFile;
  host.getSourceFile = (fileName, ...rest) => fileName === file ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) : read.call(host, fileName, ...rest);
  const virtual = ts.createProgram([file], program.getCompilerOptions(), host, program);
  return checkTemplates(ts, virtual, virtual.getSourceFile(file)!);
};

describe('checks that need a program', () => {
  it('warns about non-global attributes on custom elements', () => {
    const diagnostics = checkText('__custom.ts', `import { html } from '@cossackframework/renderer';
export const v = html\`<my-widget size="2" title="ok"></my-widget>\`;
`);
    expect(diagnostics.map(({ code, severity }) => ({ code, severity }))).toEqual([
      { code: 'COSSACK_TEMPLATE_UNKNOWN_ELEMENT_ATTRIBUTE', severity: 'warning' },
    ]);
  }, 60_000);

  it('hints at component() calls with a literal class, not a computed one', () => {
    const diagnostics = checkText('__hint.ts', `import { component, html } from '@cossackframework/renderer';
import { Button, Card } from './components';
const pick = (wide: boolean): typeof Card => wide ? Card : Card;
export const a = component(Card, { hoverable: true }, html\`<p>x</p>\`);
export const b = component(pick(true), {});
export const c = component(Button, {}, \`<b>Save</b>\`);
`);
    expect(diagnostics.map(({ code, severity, line }) => ({ code, severity, line }))).toEqual([
      { code: 'COSSACK_TEMPLATE_COMPONENT_CALL', severity: 'hint', line: 4 },
      { code: 'COSSACK_TEMPLATE_COMPONENT_CALL', severity: 'hint', line: 6 },
      { code: 'COSSACK_TEMPLATE_UNTAGGED_MARKUP', severity: 'error', line: 6 },
    ]);
  }, 60_000);
});
