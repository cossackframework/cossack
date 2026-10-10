// @vitest-environment node
import { expect, it } from 'vitest';
import { extractPageOptionsFromAst } from '../src/page-inspection';
it.each(["'/alias'", 'privateInitializer()'])('reports the removed route option without executing its value: %s', async value => {
    expect(await extractPageOptionsFromAst(`import {Page as View} from '@cossackframework/core';
        @View({route:${value},transport:'http'}) export default class Page {}`))
        .toMatchObject({ method: 'unknown', decoratorLine: 2, reason: expect.stringContaining('PageOptions.route is unsupported') });
});
