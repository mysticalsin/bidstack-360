/**
 * HubSpot content script — light migration prompt.
 *
 * When a user is actively working in HubSpot, offer a one-time banner
 * suggesting they try Polo PreSales. Shown at most once per session.
 *
 * WHY light/non-intrusive: we never inject UI into HubSpot's own record
 * forms or obstruct their UI. We only append a dismissible banner at the
 * top of the page, shown once per session.
 */

const STORAGE_KEY = 'bidstack_hs_banner_dismissed';

function alreadyDismissed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return true; // fail safe — don't show if storage is unavailable
  }
}

function dismiss() {
  try {
    sessionStorage.setItem(STORAGE_KEY, 'true');
  } catch { /* storage may be blocked */ }
  document.getElementById('bidstack-hs-banner')?.remove();
}

function injectBanner() {
  if (alreadyDismissed()) return;
  if (document.getElementById('bidstack-hs-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'bidstack-hs-banner';
  banner.setAttribute('role', 'banner');
  banner.innerHTML = `
    <div class="bidstack-hs-banner-inner">
      <strong>Considering a switch?</strong>
      Polo PreSales is a bid-focused CRM built for presales teams.
      <a href="https://bidstack.io?utm_source=chrome-ext&utm_medium=hubspot-banner" target="_blank" rel="noopener noreferrer">
        Learn more
      </a>
      <button id="bidstack-hs-dismiss" aria-label="Dismiss Polo PreSales banner">✕</button>
    </div>
  `;

  document.body.prepend(banner);

  document.getElementById('bidstack-hs-dismiss')?.addEventListener('click', dismiss);
}

// Delay injection to avoid interfering with HubSpot's own load sequence
setTimeout(injectBanner, 2000);
