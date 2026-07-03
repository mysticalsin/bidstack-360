/**
 * Polo PreSales extension options page script.
 * Loads saved config, saves updates, and tests API connectivity.
 */

const form = document.getElementById('options-form');
const apiKeyInput = document.getElementById('api-key');
const hostUrlInput = document.getElementById('host-url');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const saveStatus = document.getElementById('save-status');

// ── Load saved settings ───────────────────────────────────────────────────────

async function loadSettings() {
  const result = await chrome.storage.local.get(['apiKey', 'hostUrl']);
  if (result.apiKey) {
    apiKeyInput.value = result.apiKey;
  }
  if (result.hostUrl) {
    hostUrlInput.value = result.hostUrl;
  }
}

loadSettings();

// ── Save ──────────────────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  const hostUrl = hostUrlInput.value.trim() || 'https://api.bidstack.io/v1';

  if (!apiKey) {
    showStatus('API key is required', false);
    apiKeyInput.focus();
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  try {
    await chrome.storage.local.set({ apiKey, hostUrl });
    showStatus('Settings saved successfully', true);
  } catch (err) {
    showStatus(`Failed to save: ${err.message}`, false);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
  }
});

// ── Test Connection ───────────────────────────────────────────────────────────

testBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const hostUrl = hostUrlInput.value.trim() || 'https://api.bidstack.io/v1';

  if (!apiKey) {
    showStatus('Enter an API key first', false);
    apiKeyInput.focus();
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'Testing…';
  showStatus('', true);

  try {
    const resp = await fetch(`${hostUrl.replace(/\/$/, '')}/health`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    if (resp.ok) {
      showStatus('Connection successful! API key is valid.', true);
    } else {
      const body = await resp.json().catch(() => ({}));
      showStatus(`Connection failed (${resp.status}): ${body.message ?? resp.statusText}`, false);
    }
  } catch (err) {
    showStatus(`Network error: ${err.message}`, false);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStatus(msg, success) {
  saveStatus.textContent = msg;
  saveStatus.className = msg ? (success ? 'success' : 'error') : '';
}
