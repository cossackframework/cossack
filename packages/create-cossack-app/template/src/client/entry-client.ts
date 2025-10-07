import { bootstrap } from '@cossackframework/framework/dist/client';

const pages = import.meta.glob('../pages/**/index.ts');

bootstrap(pages);