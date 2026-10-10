// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { captureNavigationFocus } from '../src/client/navigation-focus';
afterEach(() => { document.body.innerHTML = ''; });
function setup() {
  document.body.innerHTML = '<main><input id="filter" type="search" value="Carol"></main><button id="outside">Outside</button>';
  const root = document.querySelector('main')!;
  const input = root.querySelector('input')!;
  input.focus(); input.setSelectionRange(1, 3, 'backward');
  return { root, input, restore: captureNavigationFocus(root) };
}
it('restores a unique replacement control and its text selection', () => {
  const {root,restore} = setup();
  root.innerHTML = '<input id="filter" type="search" value="Carol">';
  restore();
  const input = root.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart,input.selectionEnd,input.selectionDirection]).toEqual([1,3,'backward']);
});
it.each(['duplicate', 'type', 'name', 'outside', 'intentional'])('does not misdirect focus for %s', mode => {
  const {root,restore} = setup();
  root.innerHTML = '<input id="filter" type="search" value="Carol">';
  if (mode === 'duplicate') root.insertAdjacentHTML('beforeend','<input id="filter">');
  if (mode === 'type') root.querySelector('input')!.type = 'text';
  if (mode === 'name') root.querySelector('input')!.name = 'different';
  if (mode === 'outside') document.body.appendChild(root.querySelector('input')!);
  if (mode === 'intentional') document.getElementById('outside')!.focus();
  const active = document.activeElement;
  restore(); expect(document.activeElement).toBe(active);
});
it('ignores an anonymous control and ambiguous source IDs', () => {
  const {root,input} = setup(); input.removeAttribute('id');
  const anonymous = captureNavigationFocus(root);
  root.innerHTML = '<input id="filter" type="search">'; anonymous();
  expect(document.activeElement).toBe(document.body);
  root.querySelector('input')!.focus();
  root.insertAdjacentHTML('beforeend','<input id="filter">');
  const ambiguous = captureNavigationFocus(root);
  root.innerHTML = '<input id="filter" type="search">'; ambiguous();
  expect(document.activeElement).toBe(document.body);
});
it('retains focus in a surviving control without resetting selection', () => {
  const {input,restore} = setup(); input.setSelectionRange(4,4); restore();
  expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(4);
});
it('does not reuse old selection after the server changes the value', () => {
  const {root,restore} = setup();
  root.innerHTML = '<input id="filter" type="search" value="Changed">';
  const input = root.querySelector('input')!; input.setSelectionRange(0,0);
  restore(); expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(0);
});
