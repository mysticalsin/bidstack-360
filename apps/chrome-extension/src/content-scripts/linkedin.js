/**
 * LinkedIn content script — injects "Add to BidStack" on profile pages.
 *
 * Target: /in/* profile pages and /company/* pages.
 * Extracts: name, title, company, profile URL.
 */

import { createAddToBidStackButton, sendToBackground, showToast } from './shared.js';

const INJECTED_ATTR = 'data-bidstack-injected';
const INJECT_CONTAINER_ID = 'bidstack-linkedin-actions';

function extractProfileContext() {
  const nameEl = document.querySelector('.text-heading-xlarge') // 2024+ selectors
    ?? document.querySelector('h1.inline');
  const titleEl = document.querySelector('.text-body-medium.break-words')
    ?? document.querySelector('.pv-text-details__left-panel .text-body-medium');
  const companyEl = document.querySelector('[aria-label*="Current company"]')
    ?? document.querySelector('.pv-text-details__right-panel .t-black--light');

  const isCompany = window.location.pathname.startsWith('/company/');

  return {
    name: nameEl?.textContent?.trim() ?? document.title,
    title: titleEl?.textContent?.trim() ?? '',
    company: companyEl?.textContent?.trim() ?? '',
    profileUrl: window.location.href,
    source: 'LINKEDIN',
    entityType: isCompany ? 'ACCOUNT' : 'CONTACT',
  };
}

async function handleAddToBidStack() {
  const ctx = extractProfileContext();
  try {
    const lead = await sendToBackground('CREATE_LEAD', {
      name: ctx.name,
      title: ctx.title,
      company: ctx.company,
      linkedinUrl: ctx.profileUrl,
      source: ctx.source,
    });
    showToast(`"${lead.name}" added to BidStack`, 'success');
  } catch (err) {
    showToast(`BidStack: ${err.message}`, 'error');
  }
}

function inject() {
  if (document.getElementById(INJECT_CONTAINER_ID)) return;

  // Find the profile actions section (Connect/Follow/More buttons)
  const actionsSection = document.querySelector('.pvs-profile-actions')
    ?? document.querySelector('.pv-top-card-v2-ctas')
    ?? document.querySelector('.profile-header-actions');

  if (!actionsSection) return;

  const container = document.createElement('div');
  container.id = INJECT_CONTAINER_ID;
  container.style.cssText = 'display:inline-flex; align-items:center; margin-left:8px;';

  const btn = createAddToBidStackButton(handleAddToBidStack);
  container.appendChild(btn);
  actionsSection.appendChild(container);
}

inject();

// LinkedIn is an SPA — re-inject on navigation
const observer = new MutationObserver(() => inject());
observer.observe(document.body, { childList: true, subtree: true });
