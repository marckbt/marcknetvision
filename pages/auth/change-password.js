(function () {
  const { request, showError } = window.mnvAuth;
  const form = document.getElementById('changeForm');
  const value = (id) => document.getElementById(id).value;

  request('/api/auth/me', 'GET').then(({ ok, data }) => {
    if (!ok) return location.assign('/login?next=/change-password');
    if (data.mustChangePassword) {
      document.getElementById('changeIntro').textContent = 'Choose a new password to continue. Use at least 12 characters.';
      document.getElementById('backLink').hidden = true;
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => window.mnvAuth.logout());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('formError', '');
    if (value('password') !== value('confirm')) return showError('formError', "The new passwords don't match.");
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const { ok, data } = await request('/api/auth/change-password', 'POST', {
        current: value('current'), password: value('password'),
      });
      if (ok) return location.assign(data.redirect);
      showError('formError', data.error || 'Could not change the password.');
    } catch (err) {
      showError('formError', 'Could not reach the server.');
    }
    button.disabled = false;
  });
})();
