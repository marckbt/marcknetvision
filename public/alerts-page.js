/* Pop-out Breaking Alert System page (/wx/alerts): the alert map with
 * the list of alerts beside it. Picking one in the list shows it on the map. */
(function () {
  const A = window.MnvAlerts;
  const $ = (id) => document.getElementById(id);
  try {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('mnv-theme') || 'dark');
  } catch (e) { /* storage blocked: keep the default theme */ }

  const map = A.createMap($('baMap'));
  let data = null;

  function renderList() {
    const sort = A.getSort();
    const list = A.sorted(data, sort);
    const warnings = list.filter(a => a.bucket === 'warning').length;
    const t = Date.parse(data.fetchedAt);
    $('baMeta').textContent = (list.length
      ? warnings + ' warnings · ' + (list.length - warnings) + ' watches'
      : 'No active warnings or watches') +
      (Number.isFinite(t) ? ' · Updated ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '') +
      (data.stale ? ' (NWS unreachable — showing last data)' : '');
    $('baList').innerHTML = '<div class="wx-ba-summary">' + A.sortControlHtml(sort) + '</div>' +
      (list.length
        ? A.listHtml(list, sort)
        : '<div class="wx-ba-empty">All clear: no NWS warnings or watches are in effect in the US.</div>');
  }

  function render() {
    renderList();
    map.update(data).catch(e => { $('baMeta').textContent = 'Alert map unavailable: ' + e.message; });
  }

  A.onUpdate((d) => { data = d; render(); });
  A.load().catch(() => { $('baMeta').textContent = 'NWS alerts unavailable'; });
  A.loadCounties().catch(() => {});

  $('baReset').addEventListener('click', () => map.resetView());
  const pick = (e) => {
    const sortBtn = e.target.closest('[data-alert-sort]');
    if (sortBtn) {
      A.setSort(sortBtn.dataset.alertSort);
      renderList();
      $('baList').scrollTop = 0;
      return;
    }
    const item = e.target.closest('.wx-ba-item');
    if (item) map.select(item.dataset.alertId);
  };
  $('baList').addEventListener('click', pick);
  $('baList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); }
  });
})();
