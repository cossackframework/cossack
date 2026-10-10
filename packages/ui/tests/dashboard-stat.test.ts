import { expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { DashboardStat, type DashboardStatProps } from '../src/blocks/DashboardStat/index';
function output(props: Record<string, unknown> = {}) {
    const block=new DashboardStat();
    block.props={stats:[{id:'count',label:'Count',value:0}],...props} as DashboardStatProps;
    return renderToString(block.render());
}
it('renders native list and definition semantics without stray template text',()=>{
    const out=output({'aria-label':'Metrics',class:'custom','data-root':'stats'});
    expect(out).toContain('<ul role="list"'); expect(out).toContain('<li data-stat-id="count"');
    expect(out).toContain('<dt');expect(out).toMatch(/<dd[^>]*>0<\/dd>/);
    expect(out).toContain('aria-label="Metrics"');expect(out).toContain('data-root="stats"');
    expect(out).not.toContain(')}');expect(out).not.toContain('truncate');
});
it('keeps direction separate from favorable/unfavorable meaning and localizes visible text',()=>{
    const out=output({stats:[{id:'cost',label:'Cost',value:'$10',change:'+2',trend:'up',tone:'negative'},
        {id:'errors',label:'Errors',value:2,change:'-3',trend:'down',tone:'positive'},
        {id:'same',label:'Same',value:0,change:'0%',trend:'neutral'}],trendLabels:{down:'Less'},toneLabels:{positive:'Improved'}});
    expect(out).toContain('Increase: '); expect(out).toContain('Less: '); expect(out).toContain('No change: ');
    expect(out).toContain('Unfavorable'); expect(out).toContain('Improved');
    expect(out.match(/cs-dashboard-stat__change[^>]*text-success-text/g)).toHaveLength(1);
    expect(out.match(/cs-dashboard-stat__change[^>]*text-destructive/g)).toHaveLength(1);
    expect(out.match(/cs-dashboard-stat__change[^>]*text-muted-foreground/g)).toHaveLength(1);
});
it('escapes metric text and leaves absent changes absent',()=>{
    const out=output({stats:[{id:'one',label:'<Metric>',value:'A & B'}]});
    expect(out).toContain('&lt;Metric&gt;');expect(out).toContain('A &amp; B');expect(out).not.toContain('cs-dashboard-stat__change');
    expect(output({stats:[]})).not.toContain('<li');
});
it.each([2,3,4])('uses one narrow-screen column and %i desktop columns',columns=>{
    const out=output({columns});expect(out).toContain('grid-cols-1');expect(out).toContain(columns===2?'sm:grid-cols-2':`md:grid-cols-${columns}`);
});
it.each([
    {stats:undefined},{columns:1},{columns:'3'},{stats:[{id:'',label:'Count',value:0}]},
    {stats:[{id:'x',label:'X',value:1},{id:'x',label:'Again',value:2}]},
    {stats:[{id:'x',label:'',value:1}]},{stats:[{id:'x',label:'X',value:NaN}]},
    {stats:[{id:'x',label:'X',value:Infinity}]},{stats:[{id:'x',label:'X',value:''}]},
    {stats:[{id:'x',label:'X',value:1,trend:'up'}]}, {stats:[{id:'x',label:'X',value:1,change:''}]},
    {stats:[{id:'x',label:'X',value:1,change:'+1',tone:'green'}]},
    {stats:[{id:'x',label:'X',value:1,change:'+1',trend:'good'}]},
    {trendLabels:{up:''}}, {toneLabels:{positive:''}},
])('rejects invalid metrics/props %j', props=>expect(()=>output(props)).toThrow('DashboardStat'));
