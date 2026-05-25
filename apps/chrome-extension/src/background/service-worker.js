/**
 * BidStack Chrome Extension — Background Service Worker (Manifest V3).
 *
 * Responsibilities:
 *  - Handle messages from content scripts (create lead, search records).
 *  - Proxy API calls to BidStack so content scripts never hold the API key in DOM.
 *  - Manage token storage via chrome.storage.local.
 *
 * WHY proxy through service worker: content scripts run in web page context and
 * can be inspected by the host page. Keeping credentials only in the SW ensures
 * the API key is never exposed to page JavaScript.
 */

import { BidStackAPI } from './api.js';

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message ?? 'Unknown error' });
  });
  // Return true to keep the message channel open for async response.
  return true;
});

async function handleMessage(message) {
  const { type, payload } = message;

  switch (type) {
    case 'SEARCH_RECORDS':
      return searchRecords(payload);
    case 'CREATE_LEAD':
      return createLead(payload);
    case 'GET_TODAY_TASKS':
      return getTodayTasks();
    case 'GET_CONFIG':
      return getConfig();
    case 'SAVE_CONFIG':
      return saveConfig(payload);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function getApi() {
  const config = await getConfig();
  if (!config.apiKey) {
    throw new Error('BidStack API key not configured. Open the extension options to set it.');
  }
  return new BidStackAPI(config.apiKey, config.hostUrl);
}

async function searchRecords({ query }) {
  const api = await getApi();
  return api.search(query);
}

async function createLead(data) {
  const api = await getApi();
  return api.createLead(data);
}

async function getTodayTasks() {
  const api = await getApi();
  return api.getTodayTasks();
}

// ── Config storage ────────────────────────────────────────────────────────────

async function getConfig() {
  const result = await chrome.storage.local.get(['apiKey', 'hostUrl']);
  return {
    apiKey: result.apiKey ?? '',
    hostUrl: result.hostUrl ?? 'https://api.bidstack.io/v1',
  };
}

async function saveConfig({ apiKey, hostUrl }) {
  await chrome.storage.local.set({ apiKey, hostUrl });
  return { saved: true };
}
