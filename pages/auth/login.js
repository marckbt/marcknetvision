(function () {
  const { request, showError } = window.mnvAuth;
  const form = document.getElementById('loginForm');

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  document.getElementById('insecureWarning').hidden = location.protocol === 'https:' || local;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('formError', '');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const { ok, data } = await request('/api/auth/login', 'POST', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        next: new URLSearchParams(location.search).get('next') || '/',
      });
      if (ok) return location.assign(data.redirect);
      showError('formError', data.error || 'Login failed.');
      document.getElementById('password').value = '';
    } catch (err) {
      showError('formError', 'Could not reach the server.');
    }
    button.disabled = false;
  });
})();
