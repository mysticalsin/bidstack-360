/**
 * Shared helpers for Polo PreSales content scripts.
 * Content scripts send messages to the background service worker which holds
 * credentials — content scripts themselves never store or transmit the API key.
 */

/**
 * Send a typed message to the background service worker.
 * @template T
 * @param {string} type
 * @param {object} payload
 * @returns {Promise<T>}
 */
export function sendToBackground(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Create the "Add to Polo PreSales" button element.
 * @param {function(): void} onClick
 * @returns {HTMLButtonElement}
 */
export function createAddToBidStackButton(onClick) {
  const btn = document.createElement('button');
  btn.className = 'bidstack-inject-btn';
  btn.setAttribute('aria-label', 'Add to Polo PreSales CRM');
  btn.title = 'Add to Polo PreSales CRM';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
    <span>Add to Polo PreSales</span>
  `;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    onClick();
  });
  return btn;
}

/**
 * Show a brief toast notification anchored near the inject button.
 * @param {string} message
 * @param {'success'|'error'} type
 */
export function showToast(message, type = 'success') {
  const existing = document.querySelector('.bidstack-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `bidstack-toast bidstack-toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('bidstack-toast--fade');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Extract text selection from the page (used for quick-create from highlighted text).
 * @returns {string}
 */
export function getSelectedText() {
  return window.getSelection()?.toString().trim() ?? '';
}
