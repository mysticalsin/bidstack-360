import { describe, expect, it } from 'vitest';

import { sanitizeEmailHtml, splitQuotedText } from './sanitize';

describe('sanitizeEmailHtml', () => {
  it('removes scripts, event handlers, forms and frames', () => {
    const { html } = sanitizeEmailHtml(
      '<p onclick="steal()">Hi</p><script>alert(1)</script><form><input name="x"></form><iframe src="https://x.test"></iframe>',
    );
    expect(html).toBe('<p>Hi</p>');
  });

  it('blocks remote images and counts them, keeping inline data images', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<p>Logo</p><img src="https://tracker.test/pixel.gif" width="1"><img src="data:image/png;base64,AAAA" alt="inline">',
    );
    expect(blockedImages).toBe(1);
    expect(html).not.toContain('tracker.test');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('drops CSS backgrounds that would load remote content', () => {
    const { html } = sanitizeEmailHtml('<div style="background:url(https://t.test/a.png)">x</div>');
    expect(html).not.toContain('t.test');
  });

  it('opens links in a new tab without a referrer', () => {
    const { html } = sanitizeEmailHtml('<a href="https://acme.test">Acme</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('noopener');
  });

  it('strips javascript: links in any case or padding', () => {
    for (const href of ['javascript:alert(1)', '  JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      const { html } = sanitizeEmailHtml(`<a href="${href}">x</a>`);
      expect(html).toBe('<a>x</a>');
    }
  });

  it('drops SVG payloads and image error handlers', () => {
    const { html, blockedImages } = sanitizeEmailHtml(
      '<svg onload="alert(1)"><circle/></svg><img src="x" onerror="alert(1)">',
    );
    expect(html).toBe('<img data-blocked="true">');
    expect(blockedImages).toBe(1);
  });

  it('moves the Gmail quoted history out of the body', () => {
    const { html, quotedHtml } = sanitizeEmailHtml(
      '<div>Sounds good.</div><div class="gmail_quote"><div>On Mon, Bob wrote:</div><blockquote>Old text</blockquote></div>',
    );
    expect(html).toBe('<div>Sounds good.</div>');
    expect(quotedHtml).toContain('Old text');
  });

  it('moves the Outlook reply header and everything after it', () => {
    const { html, quotedHtml } = sanitizeEmailHtml(
      '<p>Thanks</p><div id="divRplyFwdMsg">From: Bob</div><div>Earlier message</div>',
    );
    expect(html).toBe('<p>Thanks</p>');
    expect(quotedHtml).toContain('Earlier message');
  });
});

describe('splitQuotedText', () => {
  it('splits at the "On ... wrote:" line', () => {
    const r = splitQuotedText('New reply\n\nOn Mon, 3 Nov 2026, Bob <b@acme.test> wrote:\n> old');
    expect(r.body).toBe('New reply');
    expect(r.quoted).toContain('> old');
  });

  it('splits trailing > quoted lines', () => {
    const r = splitQuotedText('Yes.\n> earlier\n> more');
    expect(r).toEqual({ body: 'Yes.', quoted: '> earlier\n> more' });
  });

  it('leaves a message without history alone', () => {
    expect(splitQuotedText('Just this.')).toEqual({ body: 'Just this.', quoted: null });
  });
});
