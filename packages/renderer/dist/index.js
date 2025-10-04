var p = Object.defineProperty;
var f = (i, e, t) => e in i ? p(i, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : i[e] = t;
var m = (i, e, t) => f(i, typeof e != "symbol" ? e + "" : e, t);
import { T as u } from "./html-BUYCdkhF.js";
import { h as x } from "./html-BUYCdkhF.js";
class b {
  constructor(e, t) {
    m(this, "start");
    m(this, "end");
    this.start = e, this.end = t;
  }
  commit(e) {
    const t = this.start.parentNode;
    let r = this.start.nextSibling;
    for (; r !== this.end; ) {
      const n = r.nextSibling;
      t.removeChild(r), r = n;
    }
    const s = this.toNodes(e);
    for (const n of s)
      t.insertBefore(n, this.end);
  }
  toNodes(e) {
    if (e instanceof u) {
      const t = document.createDocumentFragment();
      return v(e, t), Array.from(t.childNodes);
    } else return Array.isArray(e) ? e.flatMap((t) => this.toNodes(t)) : [this.toNode(e)];
  }
  toNode(e) {
    return e instanceof Node ? e : document.createTextNode(String(e));
  }
}
class N {
  constructor(e, t, r) {
    this.element = e, this.name = t, this.type = r;
  }
  commit(e) {
    switch (this.type) {
      case "attribute":
        e == null ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, String(e));
        break;
      case "boolean":
        e ? this.element.setAttribute(this.name, "") : this.element.removeAttribute(this.name);
        break;
      case "property":
        this.element[this.name] = e;
        break;
      case "event":
        this.element[`on${this.name}`] = e;
        break;
    }
  }
}
class g {
  constructor(e) {
    m(this, "_previousProps", {});
    this.element = e;
  }
  commit(e) {
    const t = e || {}, r = this._previousProps;
    this._previousProps = { ...t };
    for (const s in r)
      s in t || (s.startsWith("@") ? this.element[`on${s.slice(1)}`] = null : s.startsWith("?") ? this.element.removeAttribute(s.slice(1)) : s.startsWith(".") ? this.element[s.slice(1)] = void 0 : this.element.removeAttribute(s));
    for (const s in t) {
      const n = t[s];
      if (r[s] !== n)
        if (s.startsWith("@"))
          this.element[`on${s.slice(1)}`] = n;
        else if (s.startsWith("?")) {
          const l = s.slice(1);
          n ? this.element.setAttribute(l, "") : this.element.removeAttribute(l);
        } else s.startsWith(".") ? this.element[s.slice(1)] = n : typeof s == "string" && /^[a-zA-Z0-9-_:]+$/.test(s) && (n == null ? this.element.removeAttribute(s) : this.element.setAttribute(s, String(n)));
    }
  }
}
class A {
  constructor(e) {
    m(this, "element");
    m(this, "strings");
    this.strings = e;
    const t = e.join("?");
    this.element = document.createElement("template"), this.element.innerHTML = t;
  }
}
function v(i, e) {
  if (typeof document > "u")
    throw new Error("DOM container provided, but no document available (e.g., not in browser)");
  const t = e;
  if (!t._template || t._template.strings !== i.strings) {
    for (t._template = new A(i.strings); e.firstChild; )
      e.removeChild(e.firstChild);
    const n = t._template.element.content.cloneNode(!0);
    e.appendChild(n), t._parts = _(e), t._values = [];
  }
  const r = t._parts, s = t._values;
  t._values = [...i.values];
  for (let n = 0; n < i.values.length; n++)
    i.values[n] !== s[n] && r[n].commit(i.values[n]);
}
function _(i) {
  var s;
  const e = [], t = document.createTreeWalker(
    i,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  ), r = /* @__PURE__ */ new Map();
  for (; t.nextNode(); ) {
    const n = t.currentNode;
    if (n.nodeType === Node.ELEMENT_NODE) {
      const l = n, h = Array.from(l.attributes);
      for (const a of h)
        if (a.name === "..." && a.value === "?")
          e.push(new g(l)), l.removeAttribute("...");
        else if (a.value === "?") {
          let o = a.name, c = "attribute";
          o.startsWith(".") ? (o = o.slice(1), c = "property") : o.startsWith("?") ? (o = o.slice(1), c = "boolean") : o.startsWith("@") && (o = o.slice(1), c = "event"), l.removeAttribute(a.name), e.push(new N(l, o, c));
        }
    } else if (n.nodeType === Node.TEXT_NODE) {
      const l = n;
      if ((s = l.textContent) != null && s.includes("?")) {
        const h = l.textContent.split("?"), a = document.createDocumentFragment();
        for (let o = 0; o < h.length; o++)
          if (a.appendChild(document.createTextNode(h[o])), o < h.length - 1) {
            const c = document.createComment(""), d = document.createComment("");
            a.appendChild(c), a.appendChild(d), e.push(new b(c, d));
          }
        r.set(l, a);
      }
    }
  }
  for (const [n, l] of r.entries())
    n.parentNode.replaceChild(l, n);
  return e;
}
export {
  u as TemplateResult,
  x as html,
  v as render
};
