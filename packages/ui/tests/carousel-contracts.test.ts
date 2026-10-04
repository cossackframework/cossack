import { expect, it } from 'vitest';
import { component, renderToString, html } from '@cossackframework/renderer';
import { Carousel, type CarouselProps, type CarouselSlide } from '../src/components/Carousel';
const slides: readonly CarouselSlide[] = [{value:'a',label:'First card',content:html`<button>Action</button>`},{value:'b',label:'Second card',content:'Second'}];
const props:CarouselProps={id:'gallery',label:'Examples',slides};
it('renders named native targets, owned relationships and independent slide content',()=>{
 const out=renderToString(component(Carousel,{...props,'data-root':'root','aria-roledescription':'galerie',viewportProps:{'data-viewport':'viewport'},slides:[{...slides[0],props:{'data-slide':'slide'}},slides[1]]}));
 for(const part of ['role="region"','aria-label="Examples"','aria-roledescription="galerie"','id="gallery-viewport"','aria-controls="gallery-viewport"','tabindex="0"','data-root="root"','data-viewport="viewport"','data-slide="slide"','id="gallery-slide-a"','aria-label="First card"','aria-roledescription="slide"','<button>Action</button>'])expect(out).toContain(part);
 expect(out.match(/type="button"/g)).toHaveLength(2);expect(out).toContain('aria-disabled="true"');expect(out).toContain('aria-disabled="false"');
 expect(out).not.toContain('aria-hidden="true" tabindex');expect(out).not.toMatch(/\s(?:slides|viewportProps|onValueChange)=/);
});
it('keeps slides in normal reading and focus order without JavaScript',()=>{
 const out=renderToString(component(Carousel,props));expect(out.indexOf('First card')).toBeLessThan(out.indexOf('Second card'));expect(out).not.toMatch(/\s(?:hidden|inert)(?:\s|=|>)/);
});
it('localizes controls and renders an explicit empty state',()=>{
 const out=renderToString(component(Carousel,{...props,slides:[],previousLabel:'Zurück',nextLabel:'Weiter',viewportLabel:'Bilder',emptyLabel:'Keine Bilder'}));
 expect(out.match(/aria-disabled="true"/g)).toHaveLength(2);for(const text of ['Zurück','Weiter','Bilder','Keine Bilder'])expect(out).toContain(text);
});
it.each([{id:''},{id:'bad id'},{label:''},{slides:null},{slides:[{value:'a',label:'A'}]},{slides:[{value:'',label:'A',content:'A'}]},{slides:[{value:'a',label:'',content:'A'}]},{slides:[slides[0],slides[0]]},{previousLabel:''},{nextLabel:''},{viewportLabel:''},{emptyLabel:''},{onValueChange:4}])('rejects invalid Carousel contracts %j',patch=>{
 expect(()=>renderToString(component(Carousel,{...props,...patch} as any))).toThrow('Carousel');
});
it('rejects positional children and keeps client methods harmless on the server',()=>{
 expect(()=>renderToString(component(Carousel,props,'Lost'))).toThrow('not component children');
 const instance=new Carousel();instance.props=props;expect(()=>instance.scrollToSlide('missing')).not.toThrow();
 expect(()=>{instance.scrollNext();instance.scrollPrev();instance.scrollToSlide('a');instance.onCleanup();}).not.toThrow();
});

it('renders authored slide sizes and native styles without losing layout defaults',()=>{
 const out=renderToString(component(Carousel,{...props,slideSize:'50%',slides:[{...slides[0],size:'200px',props:{style:'color:red;'}},slides[1]]}));
 expect(out).toContain('flex:0 0 200px;min-width:0;color:red;');expect(out).toContain('flex:0 0 50%');
 expect(()=>renderToString(component(Carousel,{...props,slideSize:''}))).toThrow('slideSize');
 expect(()=>renderToString(component(Carousel,{...props,slides:[{...slides[0],size:''}]}))).toThrow('slide size');
});
