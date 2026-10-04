import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-api';
import { UI_COMPONENTS } from '../src/templates/ui.js';

afterEach(() => vi.restoreAllMocks());

describe('UI source ejection', () => {
  it.each(['auth-form', 'accordion', 'collapsible', 'tabs', 'toggle', 'toggle-group', 'toaster', 'message-scroller', 'bubble', 'marker', 'message', 'attachment', 'carousel', 'menubar', 'navigation-menu', 'pagination', 'breadcrumb', 'button-group', 'separator', 'aspect-ratio', 'skeleton', 'card', 'badge', 'kbd', 'alert', 'progress', 'spinner', 'field', 'empty', 'avatar', 'avatar-group', 'item', 'typography', 'table', 'scroll-area', 'resizable', 'sidebar', 'dropdown-menu', 'context-menu'])('ejects a complete %s component', (name) => {
    // Resolve the real UI dependency from a workspace application, as the CLI
    // does from a consuming app. This also catches source/catalog name drift.
    vi.spyOn(process, 'cwd').mockReturnValue(fileURLToPath(new URL('../../framework/', import.meta.url)));
    const source = UI_COMPONENTS[name].template();
    expect(source).not.toContain('export {};');
    expect(source).not.toMatch(/from ["']\./);
    expect(source).toContain(name === 'accordion' ? 'class AccordionItem' : `class ${UI_COMPONENTS[name].className}`);
    if (name === 'accordion' || name === 'collapsible') {
      expect(source).toContain('class DisclosureController');
      expect(source).toContain('function disclosureStyle');
    }
  });
});

it('type-checks the combined helper and component imports after menu ejection', () => {
  const root=fileURLToPath(new URL('../../framework/',import.meta.url));
  vi.spyOn(process,'cwd').mockReturnValue(root);
  const files=new Map(['auth-form', 'message-scroller', 'bubble', 'marker', 'message', 'attachment', 'carousel','toaster','menubar','navigation-menu', 'pagination', 'breadcrumb', 'button-group', 'separator', 'aspect-ratio', 'skeleton', 'card', 'badge', 'kbd', 'alert', 'progress', 'spinner', 'field', 'empty', 'avatar', 'avatar-group', 'item', 'typography', 'table', 'scroll-area', 'resizable', 'sidebar','dropdown-menu','context-menu','accordion','collapsible'].map(name=>[root+`.ejected-${name}.ts`,UI_COMPONENTS[name].template()]));
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:true,noEmit:true,experimentalDecorators:true};
  const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host),getSourceFile=host.getSourceFile.bind(host);
  host.readFile=file=>files.get(file)??read(file);
  host.fileExists=file=>files.has(file)||exists(file);
  host.getSourceFile=(file,version,onError,newFile)=>files.has(file)?ts.createSourceFile(file,files.get(file),version,true):getSourceFile(file,version,onError,newFile);
  const program=ts.createProgram([...files.keys()],options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  expect(diagnostics.map(item=>`${item.file?.fileName}:${item.start}: ${ts.flattenDiagnosticMessageText(item.messageText,' ')}`)).toEqual([]);
},30000);
