import { expect, it } from 'vitest';
import { component, renderToString, html } from '@cossackframework/renderer';
import { PasswordInput, InputGroup } from '../src/index';

it('serializes password defaults once without leaking callbacks or visual props', () => {
    const output = renderToString(component(PasswordInput, { id:'password',name:'password',value:'a<&"',placeholder:'',
        autocomplete:'new-password',disabled:true,showLabel:'Reveal',hideLabel:'Conceal',onValueChange:()=>{},'@input':()=>{} }));
    expect(output.match(/autocomplete=/g)).toHaveLength(1);
    expect(output).toContain('autocomplete="new-password"');
    expect(output).toContain('placeholder=""');
    expect(output).toContain('value="a&lt;&amp;&quot;"');
    expect(output).toContain('type="password"');
    expect(output).toContain('aria-label="Reveal"');
    expect(output).toContain('aria-controls="password"');
    expect(output.match(/ disabled(?:\s|>)/g)).toHaveLength(2);
    expect(output).not.toMatch(/onValueChange=|showLabel=|hideLabel=|@input=/i);
});

it('forwards InputGroup native props to the input while consuming adornments', () => {
    const output = renderToString(component(InputGroup,{prefix:'$',suffix:html`<span id="unit">USD</span>`,
        id:'amount',name:'amount',type:'number',min:0,required:true,'.value':12,'aria-invalid':true,'aria-describedby':'unit'}));
    expect(output).toMatch(/<input[^>]*id="amount"/);
    expect(output).toContain('value="12"');
    expect(output).toContain('aria-invalid="true"');
    expect(output).toContain('aria-describedby="unit"');
    expect(output).not.toMatch(/\s(?:prefix|suffix)=/);
});
