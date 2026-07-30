import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { component, html, render } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';

describe('nested component mount inputs', () => {
  it('makes passed props, direct properties, and children available to onMount()', () => {
    const mounted: Array<Record<string, unknown>> = [];

    class Child extends Cossack {
      declare props: { value: string };
      value = 'default';

      onMount() {
        mounted.push({
          propsValue: this.props.value,
          directValue: this.value,
          children: this.children,
        });
      }

      render() {
        return html`<p>${this.value}:${this.children}</p>`;
      }
    }

    const container = document.createElement('div');
    render(
      html`${component(Child, { value: 'passed' }, 'projected')}`,
      container,
    );

    expect(mounted).toEqual([{
      propsValue: 'passed',
      directValue: 'passed',
      children: 'projected',
    }]);
  });
});
