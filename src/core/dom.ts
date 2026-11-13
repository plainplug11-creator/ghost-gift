import currencyUrl from '../assets/currency.webp';

/** Tiny DOM helpers — no framework needed for a screen this size. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> | null = null,
  ...children: (Node | string | null | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    if (k === 'class') el.className = props[k];
    else el.setAttribute(k, props[k]);
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/** Parse a trusted, static HTML/SVG template (our own art only — never user data). */
export function html(markup: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

/**
 * Currency icon. To swap the artwork replace ONE file: src/assets/currency.webp
 * (square, transparent, ≥384 px). Vite fingerprints it on build.
 */
export const CURRENCY_URL = currencyUrl;
export const starIcon = (cls = 'star-ico') =>
  `<img class="${cls}" src="${currencyUrl}" alt="" decoding="async" draggable="false">`;
