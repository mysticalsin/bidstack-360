/**
 * Outlook Web content script — injects "Add to Polo PreSales" into email reading pane.
 *
 * Outlook renders via React and changes selectors across product versions.
 * We use a data-attribute guard to avoid double-injection.
 */

import { createAddToBidStackButton, sendToBackground, showToast } from './shared.js';

const INJECTED_ATTR = 'data-bidstack-injected';

function extractEmailContext() {
  // Outlook Web email header selectors (as of 2026)
  const senderEl = document.querySelector('[data-testid="sender-label"]')
    ?? document.querySelector('.oHYER');
  const subjectEl = document.querySelector('[data-testid="subject"]')
    ?? document.querySelector('.lnkE4');

  const senderText = senderEl?.textContent?.trim() ?? '';
  // Try to split "Name <email>" format
  const emailMatch = senderText.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : '';
  const name = emailMatch ? senderText.replace(/<[^>]+>/, '').trim() : senderText;

  return {
    name: name || email || 'Unknown Sender',
    email,
    subject: subjectEl?.textContent?.trim() ?? '',
    source: 'OUTLOOK',
  };
}

async function handleAddToPolo PreSales() {
  const ctx = extractEmailContext();
  try {
    const lead = await sendToBackground('CREATE_LEAD', {
      name: ctx.name,
      email: ctx.email,
      source: ctx.source,
      notes: `From Outlook subject: ${ctx.subject}`,
    });
    showToast(`Lead "${lead.name}" added to Polo PreSales`, 'success');
  } catch (err) {
    showToast(`Polo PreSales: ${err.message}`, 'error');
  }
}

function injectIntoEmail(toolbar) {
  if (toolbar.hasAttribute(INJECTED_ATTR)) return;
  toolbar.setAttribute(INJECTED_ATTR, 'true');
  const btn = createAddToBidStackButton(handleAddToPolo PreSales);
  toolbar.appendChild(btn);
}

function scanAndInject() {
  // Outlook email toolbar — multiple selector fallbacks for resilience
  const selectors = [
    '[data-testid="message-actions"]',
    '.ms-CommandBar',
    '.QWcxL',
  ];
  for (const sel of selectors) {
    document.querySelectorAll(`${sel}:not([${INJECTED_ATTR}])`).forEach(injectIntoEmail);
  }
}

scanAndInject();

const observer = new MutationObserver(() => scanAndInject());
observer.observe(document.body, { childList: true, subtree: true });
