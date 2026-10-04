import { expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { CommandPalette, type CommandPaletteProps } from '../src/blocks/CommandPalette/index';
import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right';
const commands = [{id:'home',label:'Home',group:'Navigation',icon:ArrowRightIcon,shortcut:'Ctrl+H'}, {id:'save',label:'Save',group:'Actions',disabled:true}] as const;
function fixture(props: Record<string, unknown> = {}) {
    const instance = new CommandPalette();
    instance.props = { id: 'palette', label: 'Application commands', commands, onSelect:()=>{}, ...props } as CommandPaletteProps;
    return instance;
}
it('composes one named native Command with rich grouped options', () => {
    const out = renderToString(fixture({ defaultOpen: true, 'data-test': 'dialog' }).render());
    expect(out.match(/<dialog\b/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Application commands"');
    expect(out).toContain('data-test="dialog"');
    expect(out).toContain('role="combobox"');
    expect(out).toContain('role="group" aria-label="Navigation"');
    expect(out).toContain('aria-description="Ctrl+H"');
    expect(out).toContain('<svg'); expect(out).toContain('<kbd');
    expect(out).toContain('aria-disabled="true"');
    expect(out.match(/<dialog\b[^>]*>/)![0]).not.toMatch(/\sopen(?:=|>|\s)/);
});
it('captures defaultOpen once and follows controlled props', () => {
    const instance=fixture({defaultOpen:true}); instance.render();
    instance.props={...instance.props,defaultOpen:false} as CommandPaletteProps;
    expect(instance.isOpen).toBe(true);
    const controlled=fixture({open:false,onOpenChange:()=>{}});controlled.render();
    controlled.props={...controlled.props,open:true} as CommandPaletteProps;
    expect(controlled.isOpen).toBe(true);
});
it.each([{id:''},{label:''},{commands:undefined},{onSelect:undefined},{open:true},{open:true,defaultOpen:true,onOpenChange:()=>{}},{open:'yes'},
    {commands:[{id:'a',label:'A'},{id:'a',label:'Duplicate'}]},{commands:[{id:'a',label:'A',shortcut:3}]}])('rejects invalid palette contracts %j', props=>{
    expect(()=>renderToString(fixture(props).render())).toThrow();
});
