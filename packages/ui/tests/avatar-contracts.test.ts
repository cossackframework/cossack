import { expect, it } from 'vitest';
import { component, renderToString, ifDefined } from '@cossackframework/renderer';
import { Avatar } from '../src/components/Avatar';
import { AvatarGroup } from '../src/components/AvatarGroup';

it('keeps a complete name when showing initials and composes native sizing styles', () => {
    const output = renderToString(component(Avatar, {alt:'  Tan   Nguyen ',style:ifDefined('opacity:0.5'),id:'person'}));
    expect(output).toContain('role="img"');
    expect(output).toContain('aria-label="Tan   Nguyen"');
    expect(output).toContain('TN');
    expect(output).toContain('width:40px;height:40px;font-size:16px;opacity:0.5');
    expect(output).toContain('id="person"');
    expect(renderToString(component(Avatar,{alt:'😀 Person'}))).toContain('😀P');
});
it('keeps decorative image and fallback content out of accessibility naming', () => {
    for (const src of ['/photo.png', undefined]) {
        const output = renderToString(component(Avatar,{alt:'',src},'?'));
        expect(output).toContain('aria-hidden="true"');
        expect(output).not.toContain('role="img"');
        expect(output).not.toContain('aria-label=');
        if (src) expect(output).toContain('alt=""');
    }
});
it('does not carry a failed request across source changes or a return to the same URL', () => {
    const avatar = new Avatar(); avatar.props={alt:'Alice',src:'/a.png'};
    expect(renderToString(avatar.render())).toContain('<img');
    (avatar as any).failedRequest = (avatar as any).requestVersion;
    expect(renderToString(avatar.render())).not.toContain('<img');
    avatar.props={alt:'Alice',src:'/b.png'};
    expect(renderToString(avatar.render())).toContain('src="/b.png"');
    avatar.props={alt:'Alice',src:'/a.png'};
    expect(renderToString(avatar.render())).toContain('src="/a.png"');
});
it.each([{alt:undefined},{size:0},{size:NaN},{shape:'triangle'},{src:12}])('rejects invalid avatar contracts', patch => {
    expect(()=>renderToString(component(Avatar,{alt:'Alice',...patch} as any))).toThrow('Avatar');
});
const items = Object.freeze([{value:'a',alt:'Alice'},{value:'b',alt:'Bob'},{value:'c',alt:'Carol'}]);
it('names immutable groups and exposes localized overflow without a focus stop', () => {
    const output=renderToString(component(AvatarGroup,{label:'People',items,max:1,overflowLabel:count=>`${count} autres`,id:'people','data-team':'one'}));
    expect(output).toContain('role="group"');expect(output).toContain('aria-label="People"');expect(output).toContain('data-team="one"');
    expect(output).toContain('aria-label="Alice"');expect(output).not.toContain('aria-label="Bob"');expect(output).toContain('2 autres');expect(output).toContain('+2');expect(output).not.toContain('tabindex');
    const none=renderToString(component(AvatarGroup,{label:'People',items,max:0}));expect(none).not.toContain('cs-avatar-group__item');expect(none).toContain('margin-inline-start:0px');expect(none).toContain('3 more people');
});
it.each([{max:-1},{max:1.2},{size:0},{overlap:-2},{overlap:36},{direction:'column'},{items:[items[0],items[0]]},{label:''},{max:0,overflowLabel:()=>''}])('rejects invalid group geometry and identity', patch => {
    expect(()=>renderToString(component(AvatarGroup,{label:'People',items,...patch} as any))).toThrow('AvatarGroup');
});
