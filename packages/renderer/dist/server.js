import { T as g } from "./html-BUYCdkhF.js";
import { h as x } from "./html-BUYCdkhF.js";
const W = /[&<>"']/g, d = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
};
function p(e) {
  return e.replace(W, (r) => d[r]);
}
const y = /\s*([.?@a-zA-Z0-9-_]+|...)=["']?$/;
function m(e) {
  const { strings: r, values: i } = e;
  let t = "", n = !1;
  for (let f = 0; f < i.length; f++) {
    let s = r[f];
    n && ((s.startsWith('"') || s.startsWith("'")) && (s = s.slice(1)), n = !1), t += s;
    const a = i[f], c = s.match(y);
    if (c) {
      const l = c[1];
      if (l === "...") {
        t = t.slice(0, -c[0].length), t += h(a), n = !0;
        continue;
      }
      const u = l.startsWith("@") ? "event" : l.startsWith(".") ? "property" : l.startsWith("?") ? "boolean" : "attribute";
      if (u === "event" || u === "property") {
        t = t.slice(0, -c[0].length), n = !0;
        continue;
      }
      if (u === "boolean") {
        t = t.slice(0, -c[0].length), a && (t += ` ${l.slice(1)}`), n = !0;
        continue;
      }
      if (a == null) {
        t = t.slice(0, -c[0].length), n = !0;
        continue;
      } else
        t += p(String(a));
    } else
      t += h(a);
  }
  let o = r[r.length - 1];
  return n && (o.startsWith('"') || o.startsWith("'")) && (o = o.slice(1)), t += o, t;
}
function h(e) {
  if (typeof e == "object" && e !== null && !(e instanceof g) && !Array.isArray(e)) {
    let r = "";
    const i = e;
    for (const t in i) {
      const n = i[t];
      t.startsWith("@") || t.startsWith(".") || (t.startsWith("?") ? n && (r += ` ${t.slice(1)}`) : n != null && (r += ` ${t}="${p(String(n))}"`));
    }
    return r ? " " + r.trim() : "";
  }
  return e instanceof g ? m(e) : Array.isArray(e) ? e.map(h).join("") : e == null ? "" : p(String(e));
}
function b(e) {
  const r = new TextEncoder(), i = m(e);
  return new ReadableStream({
    start(t) {
      t.enqueue(r.encode(i)), t.close();
    }
  });
}
export {
  g as TemplateResult,
  x as html,
  b as renderToReadableStream,
  m as renderToString
};
