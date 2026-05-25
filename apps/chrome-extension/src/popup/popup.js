/**
 * BidStack popup script.
 *
 * All API calls are proxied through the background service worker so this
 * script never touches credentials directly.
 */

// ── Utilities ─────────────────────────────────────────────────────────────────

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (resp?.error) {
        reject(new Error(resp.error));
        return;
      }
      resolve(resp);
    });
  });
}

function el(id) {
  return document.getElementById(id);
}

// ── Search ────────────────────────────────────────────────────────────────────

const searchInput = el('search-input');
const searchResults = el('search-results');

let searchDebounce = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (!q) {
    searchResults.innerHTML = '';
    return;
  }
  searchResults.innerHTML = '<div class="loading-state">Searching…</div>';
  searchDebounce = setTimeout(() => runSearch(q), 300);
});

async function runSearch(q) {
  try {
    const result = await send('SEARCH_RECORDS', { query: q });
    renderSearchResults(result?.data ?? []);
  } catch (err) {
    searchResults.innerHTML = `<div class="error-state">${escHtml(err.message)}</div>`;
  }
}

function renderSearchResults(items) {
  if (!items.length) {
    searchResults.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }
  searchResults.innerHTML = items.map((item) => `
    <a class="result-item" href="${escHtml(item.url ?? '#')}" target="_blank" rel="noopener" tabindex="0">
      <span class="result-name">${escHtml(item.name)}</span>
      <span class="result-type">${escHtml(item.type ?? '')}</span>
    </a>
  `).join('');
}

// ── Today's Tasks ─────────────────────────────────────────────────────────────

async function loadTasks() {
  const tasksList = el('tasks-list');
  try {
    const result = await send('GET_TODAY_TASKS');
    const tasks = result?.data ?? [];
    if (!tasks.length) {
      tasksList.innerHTML = '<div class="empty-state">No tasks due today</div>';
      return;
    }
    tasksList.innerHTML = tasks.map((t) => `
      <div class="task-item">
        <span class="task-title">${escHtml(t.title ?? t.name ?? 'Task')}</span>
        <span class="task-due">${escHtml(t.dueTime ?? '')}</span>
      </div>
    `).join('');
  } catch (err) {
    tasksList.innerHTML = `<div class="error-state">${escHtml(err.message)}</div>`;
  }
}

loadTasks();

// ── Quick Create Lead ─────────────────────────────────────────────────────────

const quickForm = el('quick-create-form');
const createStatus = el('create-status');

quickForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('lead-name').value.trim();
  const email = el('lead-email').value.trim();

  if (!name) {
    showCreateStatus('Name is required', false);
    el('lead-name').focus();
    return;
  }

  const submitBtn = quickForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Adding…';
  createStatus.textContent = '';

  try {
    const lead = await send('CREATE_LEAD', { name, email: email || undefined, source: 'CHROME_EXTENSION' });
    showCreateStatus(`"${lead.name}" added successfully`, true);
    quickForm.reset();
  } catch (err) {
    showCreateStatus(err.message, false);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Add Lead';
  }
});

function showCreateStatus(msg, success) {
  createStatus.textContent = msg;
  createStatus.className = success ? 'status-success' : 'status-error';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
