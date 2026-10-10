import { expect, it, vi } from 'vitest';
import { component, renderToString } from '@cossackframework/renderer';
import { InputOTP } from '../src/components/InputOTP';

it('renders one named native input and decorative slots without firing callbacks', () => {
    const change = vi.fn(), complete = vi.fn();
    const output = renderToString(component(InputOTP,{id:'code',name:'code',length:4,value:'0a1239',
        required:true,disabled:true,'aria-label':'Verification code','aria-describedby':'help',onChange:change,onComplete:complete}));
    expect(output.match(/<input\b/g)).toHaveLength(1);
    expect(output.match(/class="cs-input-otp__box /g)).toHaveLength(4);
    expect(output).toContain('value="0123"');
    expect(output).toContain('name="code"');
    expect(output).toContain('maxlength="4"');
    expect(output).toContain('pattern="[0-9]{4}"');
    expect(output).toContain('autocomplete="one-time-code"');
    expect(output).toContain('aria-label="Verification code"');
    expect(output).toContain('aria-describedby="help"');
    expect(output).toContain(' disabled');
    expect(output).not.toMatch(/onChange=|onComplete=|defaultValue=/i);
    expect(change).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});

it.each([0,-1,1.5,NaN,Infinity,33])('rejects invalid length %s', length => {
    expect(()=>renderToString(component(InputOTP,{length}))).toThrow('InputOTP length must be an integer from 1 to 32.');
});

it('keeps the uncontrolled default stable and follows controlled values without render-time reactive writes', () => {
    const input = new InputOTP();
    input.props={length:4,defaultValue:'0123'};
    expect(renderToString(input.render())).toContain('value="0123"');
    input.props={length:4,defaultValue:'9999'};
    expect(renderToString(input.render())).toContain('value="0123"');
    input.props={length:4,value:'5678'};
    expect(renderToString(input.render())).toContain('value="5678"');
    input.props={length:2,value:'90'};
    expect(renderToString(input.render())).toContain('value="90"');
});
