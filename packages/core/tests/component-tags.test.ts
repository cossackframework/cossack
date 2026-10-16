// @vitest-environment jsdom
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { component, html, render } from '@cossackframework/renderer';
import { Cossack } from '../src/shared/cossack';
import { createInstance } from '../src/shared/container';
import { Inject, Service } from '../src/shared/decorators';
import { ServiceScope, createRootServiceScope } from '../src/shared/service-scope';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('component tags in core components', () => {
  it('give a tag child the same props, children, parent and service scope as component()', async () => {
    @Service()
    class Greeting { text = 'hello'; }

    const seen: Record<string, unknown>[] = [];
    class Child extends Cossack {
      declare props: { name: string };
      @Inject(Greeting) private greeting!: Greeting;
      onMount() {
        seen.push({ name: this.props.name, children: this.children, parent: this.__parent, greeting: this.greeting });
      }
      render() { return html`<p>${this.greeting.text} ${this.props.name}</p>`; }
    }
    class TagParent extends Cossack {
      render() { return html`<main><${Child} name="Ada">projected</${Child}></main>`; }
    }
    class CallParent extends Cossack {
      render() { return html`<main>${component(Child, { name: 'Ada' }, 'projected')}</main>`; }
    }

    const scope = new ServiceScope(createRootServiceScope(), [Greeting]);
    const results = [];
    for (const Parent of [TagParent, CallParent]) {
      const parent = createInstance(Parent, { serviceScope: scope });
      const container = document.createElement('div');
      parent.mount(container);
      await settle();
      await settle();
      results.push({ parent, markup: container.innerHTML.replace(/<!--[^]*?-->/g, '') });
    }
    expect(results[0].markup).toBe('<main><p>hello Ada</p></main>');
    expect(results[1].markup).toBe(results[0].markup);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ name: 'Ada', children: 'projected', parent: results[0].parent });
    expect(seen[1]).toMatchObject({ name: 'Ada', children: 'projected', parent: results[1].parent });
    expect(seen[0].greeting).toBe(scope.resolveDeclared(Greeting));
    expect(seen[1].greeting).toBe(seen[0].greeting);
  });

  it('renders a tag child through render() like component()', async () => {
    class Child extends Cossack {
      declare props: { value: string };
      render() { return html`<b>${this.props.value}</b>`; }
    }
    const container = document.createElement('div');
    render(html`<${Child} value="x" />`, container);
    const other = document.createElement('div');
    render(html`${component(Child, { value: 'x' })}`, other);
    await settle();
    expect(container.textContent).toBe('x');
    expect(container.innerHTML.replace(/<!--[^]*?-->/g, '')).toBe(other.innerHTML.replace(/<!--[^]*?-->/g, ''));
  });
});
