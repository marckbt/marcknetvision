(function () {
  const { request, showError } = window.mnvAuth;
  const $ = (id) => document.getElementById(id);
  const dialog = $('passwordDialog');
  let dialogUser = null;

  const when = (iso) => (iso ? new Date(iso).toLocaleString() : 'Never');

  function statusText(u) {
    const parts = [];
    if (u.builtIn) parts.push('Admin');
    parts.push(u.disabled ? 'Disabled' : 'Active');
    if (u.mustChangePassword) parts.push('Must change password');
    return parts.join(' · ');
  }

  function actionButton(label, handler, danger) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = danger ? 'auth-danger' : 'auth-secondary';
    b.addEventListener('click', handler);
    return b;
  }

  async function act(url, method, body) {
    showError('listError', '');
    const { ok, status, data } = await request(url, method, body);
    if (status === 401) return location.assign('/login?next=/admin');
    if (!ok) showError('listError', data.error || 'That action failed.');
    await loadUsers();
  }

  function renderUsers(users) {
    const rows = $('userRows');
    rows.textContent = '';
    users.forEach((u) => {
      const tr = rows.insertRow();
      [u.email, statusText(u), when(u.lastLoginAt), String(u.activeSessions), when(u.createdAt)]
        .forEach((text) => { tr.insertCell().textContent = text; });
      const cell = tr.insertCell();
      cell.className = 'admin-actions';
      if (u.builtIn) {
        const link = document.createElement('a');
        link.href = '/change-password';
        link.textContent = 'Change Password';
        cell.append(link);
        return;
      }
      cell.append(actionButton('Change Password', () => openPasswordDialog(u)));
      if (u.activeSessions) {
        cell.append(actionButton('End Sessions', () => act(`/api/admin/users/${u.id}/end-sessions`, 'POST')));
      }
      cell.append(actionButton(u.disabled ? 'Enable' : 'Disable',
        () => act(`/api/admin/users/${u.id}/disabled`, 'POST', { disabled: !u.disabled })));
      cell.append(actionButton('Delete', () => {
        if (confirm(`Delete ${u.email}? This can't be undone.`)) act(`/api/admin/users/${u.id}`, 'DELETE');
      }, true));
    });
  }

  async function loadUsers() {
    const { ok, status, data } = await request('/api/admin/users', 'GET');
    if (status === 401) return location.assign('/login?next=/admin');
    if (ok) renderUsers(data.users);
    else showError('listError', data.error || 'Could not load users.');
  }

  function openPasswordDialog(user) {
    dialogUser = user;
    $('passwordFor').textContent = user.email;
    $('resetPassword').value = '';
    $('resetRequireChange').checked = true;
    showError('passwordError', '');
    dialog.showModal();
  }

  $('passwordCancel').addEventListener('click', () => dialog.close());

  $('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data } = await request(`/api/admin/users/${dialogUser.id}/password`, 'POST', {
      password: $('resetPassword').value, requireChange: $('resetRequireChange').checked,
    });
    if (!ok) return showError('passwordError', data.error || 'Could not change the password.');
    dialog.close();
    loadUsers();
  });

  $('addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('addError', '');
    const { ok, data } = await request('/api/admin/users', 'POST', {
      email: $('newEmail').value, password: $('newPassword').value, requireChange: $('newRequireChange').checked,
    });
    if (!ok) return showError('addError', data.error || 'Could not add the user.');
    e.target.reset();
    loadUsers();
  });

  $('logoutBtn').addEventListener('click', () => window.mnvAuth.logout());
  loadUsers();
})();
