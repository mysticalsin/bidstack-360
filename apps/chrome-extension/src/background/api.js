/**
 * Thin fetch wrapper used by the service worker to call the BidStack REST API.
 * All API credentials are held exclusively inside the service worker context.
 */

export class BidStackAPI {
  /** @param {string} apiKey @param {string} baseUrl */
  constructor(apiKey, baseUrl = 'https://api.bidstack.io/v1') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /** @private */
  async _fetch(method, path, body) {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'bidstack-chrome-ext/0.1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      let msg = resp.statusText;
      try {
        const json = await resp.json();
        msg = json.message ?? json.error ?? msg;
      } catch { /* ignore parse errors */ }
      throw new Error(`BidStack API ${resp.status}: ${msg}`);
    }

    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * Full-text search across leads, contacts, and opportunities.
   * @param {string} query
   */
  async search(query) {
    return this._fetch('GET', `/search?q=${encodeURIComponent(query)}&limit=10`);
  }

  /** Create a new lead. */
  async createLead(data) {
    return this._fetch('POST', '/leads', data);
  }

  /** Get tasks due today for the authenticated user. */
  async getTodayTasks() {
    const today = new Date().toISOString().split('T')[0];
    return this._fetch('GET', `/tasks?dueDate=${today}&limit=20`);
  }
}
