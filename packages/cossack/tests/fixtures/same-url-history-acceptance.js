import { expect } from 'vitest';
import { expect as browserExpect } from '@playwright/test';

export async function checkSameUrlHistory(browser, origin, backend) {
  for (const boundary of ['restoration','confirmation']) {
    const page = await browser.newPage();
    let releaseResponse;
    let observed = backend.reads.length;
    const expectReads = (...searches) => {
      const actual = backend.reads.slice(observed); observed = backend.reads.length;
      const expected = searches.flatMap(search => ['layout','page'].map(kind => ({kind,search,page:1})));
      const order = values => values.map(value => JSON.stringify(value)).sort();
      expect(order(actual)).toEqual(order(expected));
    };
    const entry = () => page.evaluate(() => history.state.__cossackNavigation.location);
    const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    try {
      await page.goto(origin+'/list?search=same');
      await browserExpect.poll(() => page.evaluate(() => window.__cossackReady)).toBe(true);
      await browserExpect(page.locator('#query-items')).toHaveText('same:1:name:');
      await settled(); expectReads('same');
      await page.locator('#page-draft').fill('same URL draft');
      await page.locator('#service-draft').fill('same URL service');
      await page.locator('#draft-file').setInputFiles({name:'same-url.txt',mimeType:'text/plain',buffer:Buffer.from('local draft')});
      await page.evaluate(() => history.replaceState({...history.state,marker:'first'},'',location.href));
      const first = await entry();
      expect(await page.evaluate(async () => (await window.__queryTestApp.navigate(location.pathname+location.search)).outcome)).toBe('completed');
      await page.evaluate(() => history.replaceState({...history.state,marker:'second'},'',location.href));
      const second = await entry();
      const historyLength = await page.evaluate(() => history.length);
      expect(second).toEqual({group:first.group,position:first.position+1});
      await settled(); expectReads();
      await page.locator('#toggle-guard').click();

      if (boundary === 'restoration') {
        // Delay the framework's actual forward restoration, while native back
        // still activates the first entry. Both entries have the same URL.
        await page.evaluate(() => {
          const go=history.go.bind(history);
          window.__restoreHistoryGo=()=>{history.go=go;};
          history.go=delta=>{
            if(delta===1) window.__releaseHistoryRestore=()=>{history.go=go;delete window.__releaseHistoryRestore;go(delta);};
            else go(delta);
          };
        });
      }
      const checks=Number(await page.locator('#guard-checks').textContent());
      await page.evaluate(() => history.back());
      await browserExpect.poll(async () => Number(await page.locator('#guard-checks').textContent())).toBeGreaterThan(checks);
      if (boundary === 'restoration') {
        await browserExpect.poll(() => page.evaluate(() => typeof window.__releaseHistoryRestore)).toBe('function');
        expect(await entry()).toEqual(first);
        expect(await page.evaluate(() => history.state.marker)).toBe('first');
        await page.locator('#toggle-guard').click();
        await page.evaluate(() => {
          window.__newHistoryResult=undefined;
          void window.__queryTestApp.navigate('/list?search=restored-latest').then(result=>{window.__newHistoryResult=result.outcome;});
        });
        await settled(); expectReads();
        expect(await page.evaluate(() => window.__newHistoryResult)).toBeUndefined();
        await page.evaluate(() => window.__releaseHistoryRestore());
        await browserExpect.poll(() => page.evaluate(() => window.__newHistoryResult)).toBe('completed');
        expect(await entry()).toEqual({group:second.group,position:second.position+1});
      } else {
        await browserExpect.poll(entry).toEqual(second);
        expect(await page.evaluate(() => history.state.marker)).toBe('second');
        await settled(); expectReads();
        // Hold the confirmed traversal's real SSR response after its backend
        // reads. A new intent must supersede it without another restoration.
        await page.route(url=>url.pathname==='/list' && url.searchParams.get('search')==='same',async route=>{
          const response=await route.fetch();
          await new Promise(resolve=>{releaseResponse=resolve;});
          await route.fulfill({response});
        });
        await page.evaluate(() => window.__cossack_invalidatePageCache());
        await page.locator('#confirm-history').click();
        await browserExpect.poll(() => Boolean(releaseResponse)).toBe(true);
        expect(await entry()).toEqual(first); expectReads('same');
        await page.locator('#toggle-guard').click();
        expect(await page.evaluate(async () => (await window.__queryTestApp.navigate('/list?search=confirmed-latest')).outcome)).toBe('completed');
        expect(await entry()).toEqual({group:first.group,position:first.position+1});
      }
      const search=boundary==='restoration'?'restored-latest':'confirmed-latest';
      await browserExpect(page.locator('#query-items')).toHaveText(search+':1:name:');
      await browserExpect(page.locator('#layout-summary')).toHaveText(search+':1');
      await browserExpect(page.locator('#page-draft')).toHaveValue('same URL draft');
      await browserExpect(page.locator('#service-draft')).toHaveValue('same URL service');
      await settled(); expectReads(search);
      await browserExpect(page.locator('#file-name')).toHaveText('same-url.txt');
      expect(await page.evaluate(() => history.length)).toBe(historyLength+(boundary==='restoration'?1:0));
      const finalEntry=await entry();
      releaseResponse?.(); await page.unrouteAll({behavior:'wait'}); await settled();
      expect(await entry()).toEqual(finalEntry);
      expect(new URL(page.url()).searchParams.get('search')).toBe(search);
      await browserExpect(page.locator('#query-items')).toHaveText(search+':1:name:');
      await browserExpect(page.locator('#page-draft')).toHaveValue('same URL draft');
      await browserExpect(page.locator('#layout-summary')).toHaveText(search+':1');
      await browserExpect(page.locator('#service-draft')).toHaveValue('same URL service');
      await browserExpect(page.locator('#file-name')).toHaveText('same-url.txt');
      expect(await page.evaluate(() => history.length)).toBe(historyLength+(boundary==='restoration'?1:0));
      expectReads();
    } finally {
      releaseResponse?.();
      await page.evaluate(() => {window.__restoreHistoryGo?.();window.__releaseHistoryRestore?.();}).catch(()=>{});
      await page.unrouteAll({behavior:'wait'}); await page.close();
    }
  }
}
