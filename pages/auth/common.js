/* Shared by the login, change-password and admin pages. */
window.mnvAuth = {
  // JSON request; resolves to { ok, status, data }.
  async request(url, method, body) {
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    let data = {};
    try { data = await res.json(); } catch (e) { /* no JSON body */ }
    return { ok: res.ok, status: res.status, data };
  },

  showError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message || '';
    el.hidden = !message;
  },

  async logout() {
    await this.request('/api/auth/logout', 'POST');
    location.assign('/login');
  },
};
