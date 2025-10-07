import { CossackDurableObject } from '@cossackframework/core';
import { IndexPage } from './pages';

export class AppDurableObject extends CossackDurableObject {
  get pages() {
    return [IndexPage];
  }
}