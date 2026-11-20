/**
 * Email HTML for the thread view.
 *
 * Provider HTML is hostile by default. The body is parsed inert (DOMParser
 * never runs scripts or loads images) and rebuilt from an allowlist of tags
 * and attributes, so anything not listed (scripts, styles, forms, frames,
 * event handlers, SVG) never reaches the page. Remote images are blocked,
 * not proxied, so opening a thread never tells the sender it was read.
 * class and id are dropped (a sender could reuse the app's own utility
 * classes to overlay the page) and style keeps only a short property list.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'img', 'ins', 'li', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strike', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

/** Dropped with their content, not unwrapped. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object',
  'embed', 'svg', 'math', 'head', 'title', 'textarea', 'select', 'button', 'form',
]);

const ALLOWED_ATTRS = new Set([
  'align', 'alt', 'border', 'cellpadding', 'cellspacing', 'colspan', 'dir',
  'height', 'href', 'rowspan', 'src', 'style', 'title', 'type', 'valign', 'width',
]);

const QUOTE_SELECTORS = [
  '.gmail_quote',
  'blockquote[type="cite"]',
  '#divRplyFwdMsg',
  '#appendonsend',
  '#mail-editor-reference-message-container',
  '.moz-cite-prefix',
  '.yahoo_quoted',
];

const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
const INLINE_IMAGE = /^data:image\/(png|gif|jpe?g|webp);base64,/i;
/** Typography, colour and box spacing only: nothing that positions, layers or loads. */
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-style', 'font-weight',
  'line-height', 'text-align', 'text-decoration', 'text-transform', 'vertical-align',
  'white-space', 'width', 'max-width', 'height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-collapse', 'border-radius',
]);
/** Plain values only; the one function allowed is a colour. */
const SAFE_STYLE_VALUE = /^(?:[#%.,\w\s'"-]|rgba?\([\d\s.,%]+\))+$/i;
const QUOTE_MARK = 'data-quote';

function cleanStyle(value: string): string {
  return value
    .split(';')
    .map((decl) => {
      const at = decl.indexOf(':');
      if (at < 0) return null;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const val = decl.slice(at + 1).trim();
      if (!ALLOWED_STYLE_PROPS.has(prop) || !val || !SAFE_STYLE_VALUE.test(val)) return null;
      return `${prop}: ${val}`;
    })
    .filter((decl): decl is string => decl !== null)
    .join('; ');
}

export interface SanitizedEmail {
  /** Safe body HTML without the quoted history. */
  html: string;
  /** Quoted history (earlier messages), safe HTML, or null. */
  quotedHtml: string | null;
  /** Remote images removed from the body and the quoted history. */
  blockedImages: number;
}

function cleanChildren(source: Node, target: Node, out: Document, stats: { blocked: number }): void {
  source.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(out.createTextNode(child.textContent ?? ''));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) return;
    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown wrapper (custom tags, <o:p>, <body>): keep its safe content.
      cleanChildren(el, target, out, stats);
      return;
    }
    const copy = out.createElement(tag);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (!ALLOWED_ATTRS.has(name)) continue;
      if (name === 'href' && !SAFE_HREF.test(value)) continue;
      if (name === 'src') continue;
      if (name === 'style') {
        const style = cleanStyle(value);
        if (style) copy.setAttribute('style', style);
        continue;
      }
      copy.setAttribute(name, value);
    }
    if (el.matches(QUOTE_SELECTORS.join(','))) copy.setAttribute(QUOTE_MARK, 'true');
    if (tag === 'a' && copy.hasAttribute('href')) {
      copy.setAttribute('target', '_blank');
      copy.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (tag === 'img') {
      const src = (el.getAttribute('src') ?? '').trim();
      if (INLINE_IMAGE.test(src)) {
        copy.setAttribute('src', src);
      } else {
        copy.setAttribute('data-blocked', 'true');
        if (src) stats.blocked += 1;
      }
    }
    cleanChildren(el, copy, out, stats);
    target.appendChild(copy);
  });
}

export function sanitizeEmailHtml(raw: string): SanitizedEmail {
  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const root = out.createElement('div');
  const stats = { blocked: 0 };
  cleanChildren(parsed.body, root, out, stats);

  let quotedHtml: string | null = null;
  const quote = root.querySelector(`[${QUOTE_MARK}]`);
  if (quote) {
    quote.removeAttribute(QUOTE_MARK);
    const holder = out.createElement('div');
    let node: ChildNode | null = quote;
    // The quote marker and everything after it at the same level is history.
    while (node) {
      const next: ChildNode | null = node.nextSibling;
      holder.appendChild(node);
      node = next;
    }
    quotedHtml = holder.innerHTML.trim() || null;
  }

  return { html: root.innerHTML.trim(), quotedHtml, blockedImages: stats.blocked };
}

const QUOTE_HEADER = [
  /^On .+wrote:\s*$/,
  /^Le .+a écrit\s*:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^From:\s.+$/,
  /^_{10,}\s*$/,
];

/** Split a plain-text body into the new text and the quoted history. */
export function splitQuotedText(text: string): { body: string; quoted: string | null } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex(
    (line, i) =>
      QUOTE_HEADER.some((re) => re.test(line.trim())) ||
      (line.startsWith('>') && lines.slice(i).every((l) => l.startsWith('>') || l.trim() === '')),
  );
  if (at <= 0) return { body: text.trim(), quoted: null };
  return {
    body: lines.slice(0, at).join('\n').trim(),
    quoted: lines.slice(at).join('\n').trim() || null,
  };
}
