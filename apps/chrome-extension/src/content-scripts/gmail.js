/**
 * Gmail content script — injects "Add to BidStack" into email toolbar.
 *
 * Observation: Gmail renders email threads dynamically (SPA). We use a
 * MutationObserver to detect new email views and inject our button each time.
 *
 * Selector strategy: `.G3` is the email action bar in Gmail's current DOM.
 * If Gmail's markup changes, the observer falls back gracefully (no inject,
 * no console error in production).
 */

import { createAddToBidStackButton, sendToBackground, showToast } from './shared.js';

const INJECTED_ATTR = 'data-bidstack-injected';

function extractEmailContext() {
  // Attempt to pull sender name + email from Gmail's open message header
  const senderEl = document.querySelector('.gD');
  const subjectEl = document.querySelector('.hP');
  return {
    name: senderEl?.getAttribute('name') ?? senderEl?.textContent?.trim() ?? '',
    email: senderEl?.getAttribute('email') ?? '',
    subject: subjectEl?.textContent?.trim() ?? '',
    source: 'GMAIL',
  };
}

async function handleAddToBidStack() {
  const ctx = extractEmailContext();
  try {
    const lead = await sendToBackground('CREATE_LEAD', {
      name: ctx.name || ctx.email || 'Unknown Sender',
      email: ctx.email,
      source: ctx.source,
      notes: `From Gmail subject: ${ctx.subject}`,
    });
    showToast(`Lead "${lead.name}" added to BidStack`, 'success');
  } catch (err) {
    showToast(`BidStack: ${err.message}`, 'error');
  }
}

function injectIntoEmail(toolbar) {
  if (toolbar.hasAttribute(INJECTED_ATTR)) return;
  toolbar.setAttribute(INJECTED_ATTR, 'true');

  const btn = createAddToBidStackButton(handleAddToBidStack);
  toolbar.appendChild(btn);
}

function scanAndInject() {
  // Gmail's reply/action toolbar — selector targets the action bar in email view
  document.querySelectorAll('.G3:not([' + INJECTED_ATTR + '])').forEach(injectIntoEmail);
}

// Run on first load
scanAndInject();

// Watch for Gmail SPA navigation (new emails opened)
const observer = new MutationObserver(() => scanAndInject());
observer.observe(document.body, { childList: true, subtree: true });
