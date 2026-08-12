/* BizNews page — Bloomberg-TV-style markets UI.
 *
 * Runs alongside the shared app.js (which provides the news sidebar chrome
 * and the weather ticker). On this page:
 *   • middle column  → market groups: US indices, global indices,
 *                      commodities, major US stocks, ETFs
 *   • main panel     → CNBC live TV (autoplays on load), a sector heat map,
 *                      or a selected symbol's historical chart
 *
 * Market data comes from /api/stocks (Yahoo Finance, cached server-side) and
 * /api/stock-history/:symbol for the charts.
 */
(function () {
  let stocksData = null;
  let historyRange = '1mo';
  let historySymbol = null;          // symbol currently charted
  let view = 'live';                 // main panel: 'live' | 'history'
  let marketsView = 'list';          // markets column: 'list' | 'heat'

  // CNBC's own live-tv page can't be embedded (CSP allows only *.cnbc.com)
  // and needs a TV-provider sign-in, so the server resolves CNBC's free
  // live YouTube broadcast for us via /api/live-tv (see server.js) and we
  // embed that. Autoplay requires mute=1, which the server includes.
  const CNBC_SITE = 'https://www.cnbc.com/live-tv/';
  let liveTv = null;   // { channel, videoId, embedUrl, watchUrl, isFallback }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  const fmtNum = (n) => (n == null ? '--' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const arrow = (dir) => dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';

  // ----- Data -----
  async function loadStocks() {
    try {
      const res = await fetch('/api/stocks');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      stocksData = await res.json();
    } catch (e) {
      console.error('[BizNews] loadStocks failed:', e.message);
    }
    renderMarkets($('weatherScrollArea'));
    renderTickerQuotes();
    if (view === 'history' && historySymbol) showStockHistory(historySymbol, historyRange);
  }

  // ----- Middle column: market groups -----
  function marketRow(r) {
    const cls = r.direction === 'up' ? 'up' : r.direction === 'down' ? 'down' : 'flat';
    const pct = r.changePercent == null ? '' : (r.changePercent > 0 ? '+' : '') + r.changePercent + '%';
    const chg = r.change == null ? '' : (r.change > 0 ? '+' : '') + fmtNum(r.change);
    const active = r.symbol === historySymbol ? ' active' : '';
    // A carried-forward quote (last refresh was rate limited) is dimmed and
    // marked so an old price is never shown as if it were live.
    const stale = r.stale && r.price != null;
    const staleCls = stale ? ' stale' : '';
    const staleMark = stale ? '<span class="market-stale-dot" aria-hidden="true">•</span>' : '';
    const tip = stale
      ? `${r.name} — last known price (awaiting refresh) · click for history`
      : `${r.name} — click for history`;
    return `
      <div class="market-row${active}${staleCls}" onclick="bizShowHistory('${esc(r.symbol)}')" title="${esc(tip)}">
        <div class="market-name">
          <span class="market-ticker">${esc(r.ticker || '')}${staleMark}</span>
          <span class="market-label">${esc(r.name)}</span>
        </div>
        <div class="market-figures ${cls}">
          <span class="market-price">${fmtNum(r.price)}</span>
          <span class="market-change">${arrow(r.direction)} ${chg} <span class="market-pct">${pct}</span></span>
        </div>
      </div>`;
  }

  function group(label, rows) {
    if (!rows || !rows.length) return '';
    return `<div class="market-group-label">${esc(label)}</div>` + rows.map(marketRow).join('');
  }

  // Exposed to app.js via window.bizRenderMarkets — app.js calls this
  // wherever it would otherwise render sports events into this column.
  // Renders either the quote list or the heat map, per marketsView.
  function renderMarkets(areaEl) {
    areaEl = areaEl || $('weatherScrollArea');
    if (!areaEl) return;
    if (!stocksData || !Array.isArray(stocksData.indexes)) {
      areaEl.innerHTML = '<div class="loading-spinner">Loading markets…</div>';
      return;
    }
    syncMarketViewToggle();
    if (marketsView === 'heat') { renderHeatMapInto(areaEl); return; }
    const idx = stocksData.indexes || [];
    areaEl.innerHTML =
      group('US Markets',   idx.filter(i => i.region === 'US')) +
      group('Global Markets', idx.filter(i => i.region !== 'US')) +
      group('Commodities',  stocksData.commodities) +
      group('Stocks',       stocksData.stocks) +
      group('ETFs',         stocksData.etfs);
  }
  window.bizRenderMarkets = renderMarkets;

  // ----- Markets column: sector + commodity heat map -----
  function heatCells(rows) {
    return (rows || []).slice()
      .sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0))
      .map(r => {
        const pct = r.changePercent == null ? null : r.changePercent;
        return `<div class="heat-cell" style="background:${heatColor(pct || 0)}"
                     onclick="bizShowHistory('${esc(r.symbol)}')"
                     title="${esc(r.name)} — click for history">
          <div class="heat-name">${esc(r.name)}</div>
          <div class="heat-pct">${pct == null ? '--' : (pct > 0 ? '+' : '') + pct + '%'}</div>
        </div>`;
      }).join('');
  }

  function renderHeatMapInto(areaEl) {
    if (!areaEl) return;
    const sectors = stocksData && stocksData.sectors;
    const commodities = stocksData && stocksData.commodities;
    if (!Array.isArray(sectors) && !Array.isArray(commodities)) {
      areaEl.innerHTML = '<div class="loading-spinner">Loading heat map…</div>';
      return;
    }
    areaEl.innerHTML =
      (Array.isArray(sectors) && sectors.length
        ? `<div class="market-group-label">S&amp;P 500 Sectors</div><div class="heat-grid heat-grid-col">${heatCells(sectors)}</div>` : '') +
      (Array.isArray(commodities) && commodities.length
        ? `<div class="market-group-label">Commodities</div><div class="heat-grid heat-grid-col">${heatCells(commodities)}</div>` : '');
  }

  // Keep the header toggle's label/state in sync with marketsView.
  function syncMarketViewToggle() {
    const btn = $('marketViewToggle');
    if (!btn) return;
    const heat = marketsView === 'heat';
    btn.classList.toggle('auto-on', heat);
    const lbl = btn.querySelector('.market-view-label');
    if (lbl) lbl.textContent = heat ? 'Markets' : 'Heat Map';
    btn.title = heat ? 'Show market quotes' : 'Show sector & commodity heat map';
  }

  // ----- Bottom ticker: scrolling market quotes -----
  // Same data as the Markets column. Uses the shared .ticker-track marquee
  // (content duplicated so the loop is seamless); app.js routes the ticker
  // here on this page instead of weather/sports.
  function tickerQuote(r) {
    const cls = r.direction === 'up' ? 'up' : r.direction === 'down' ? 'down' : 'flat';
    const pct = r.changePercent == null ? '' : (r.changePercent > 0 ? '+' : '') + r.changePercent + '%';
    return `<div class="ticker-item ticker-quote ${cls}" onclick="bizShowHistory('${esc(r.symbol)}')" title="${esc(r.name)} — click for history">
      <span class="tq-name">${esc(r.ticker || r.name)}</span>
      <span class="tq-price">${fmtNum(r.price)}</span>
      <span class="tq-change">${arrow(r.direction)} ${pct}</span>
    </div>`;
  }

  function renderTickerQuotes() {
    const track = $('tickerTrack');
    if (!track) return;
    if (!stocksData) {
      track.innerHTML = '<span class="ticker-loading">Loading market data…</span>';
      return;
    }
    const rows = [
      ...(stocksData.indexes || []),
      ...(stocksData.commodities || []),
      ...(stocksData.stocks || []),
      ...(stocksData.etfs || []),
    ].filter(r => r && r.price != null);
    if (!rows.length) {
      track.innerHTML = '<span class="ticker-loading">Market data unavailable</span>';
      return;
    }
    const html = rows.map(tickerQuote).join('');
    track.style.transform = '';      // clear any leftover weather-cycle transform
    track.innerHTML = html + html;   // duplicate for a seamless loop
    requestAnimationFrame(() => {
      const total = track.scrollWidth / 2;
      if (!total) return;
      track.style.animationDuration = Math.max(60, total / 60) + 's';
    });
  }
  window.bizRenderTicker = renderTickerQuotes;

  // ----- Main panel header (view switcher + range buttons) -----
  function panelHeader(title) {
    const ranges = ['5d', '1mo', '3mo', '6mo', '1y'];
    const rangeBtns = view === 'history' ? `
      <div class="market-range-controls">
        ${ranges.map(r => `<button class="range-btn${r === historyRange ? ' active' : ''}" onclick="bizSetRange('${r}')">${r.toUpperCase()}</button>`).join('')}
      </div>` : '';
    return `
      <div class="market-panel-head">
        <h2>${esc(title)}</h2>
        <div class="market-panel-actions">
          <button class="market-view-btn${view === 'live' ? ' active' : ''}" onclick="showCNBCLive()">&#9654; CNBC Live</button>
          ${rangeBtns}
        </div>
      </div>`;
  }

  // ----- CNBC live TV: chromeless popup window -----
  // CNBC can't be embedded in-page (its CSP blocks framing and the channel
  // needs a TV-provider sign-in), so we open it in a chromeless popup sized
  // to the main content area — the same pattern the dashboard already uses
  // for ESPN / YouTube TV. Returns the window handle, or null if the
  // browser's popup blocker stopped it (which happens when we try on page
  // load rather than from a click).
  function openCNBCPopup(url) {
    const target = url || CNBC_SITE;
    const main = document.getElementById('mainContent');
    const rect = main ? main.getBoundingClientRect() : { left: 0, top: 0, width: 1200, height: 800 };
    const ticker = document.getElementById('tickerBar');
    const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
    const left = Math.round(window.screenX + rect.left);
    const top = Math.round(window.screenY + rect.top + (window.outerHeight - window.innerHeight));
    const width = Math.round(rect.width);
    const height = Math.round(rect.height - tickerH);
    try {
      return window.open(
        target,
        'cnbcLive',
        `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
      );
    } catch (_) {
      return null;
    }
  }

  // Main-panel card for the live-TV view: shows whether the popup opened and
  // gives one-click ways to (re)open it — needed because a popup attempted on
  // page load is usually blocked until the user clicks.
  function renderLiveCard(state) {
    view = 'live';
    historySymbol = null;
    const el = $('marketPanelContent');
    if (!el) return;
    if (typeof showPanel === 'function') showPanel('marketPanel');
    renderMarkets($('weatherScrollArea'));

    const blocked = state === 'blocked';
    const note = blocked
      ? 'Your browser blocked the pop-up window. Click below to open CNBC Live.'
      : 'CNBC Live is playing in its own window. Use the buttons below to re-open it.';
    const ytBtn = liveTv && liveTv.youtubeUrl
      ? `<button class="biznews-back-link" onclick="bizOpenCNBCYouTube()">Open CNBC live on YouTube &rarr;</button>`
      : '';
    el.innerHTML = panelHeader('CNBC Live') +
      `<p class="market-subtitle">${esc(note)}</p>
       <div class="market-video-offline">
         <svg viewBox="0 0 120 28" xmlns="http://www.w3.org/2000/svg" style="width:150px;height:32px;">
           <rect x="0" y="0" width="120" height="28" rx="4" fill="#005594"/>
           <text x="60" y="20" text-anchor="middle" font-family="'Arial','Helvetica',sans-serif" font-size="16" font-weight="900" fill="#fff" letter-spacing="2">CNBC</text>
         </svg>
         <p>CNBC blocks in-page embedding, so it opens in its own window sized to this panel.</p>
         <div class="market-video-actions">
           <button class="biznews-back-link" onclick="showCNBCLive()">${blocked ? 'Open CNBC Live' : 'Re-open CNBC Live'} &rarr;</button>
           ${ytBtn}
         </div>
         <p style="font-size:11px;color:var(--text-muted);">CNBC.com's live channel may ask for a TV-provider sign-in; the YouTube stream is free.</p>
       </div>`;
  }

  // (The sector heat map now lives in the Markets column — see
  // renderHeatMapInto() — toggled from the button beside Auto-Scroll.)

  // Red→green background based on % move (clamped to ~±3%).
  function heatColor(pct) {
    const p = Math.max(-3, Math.min(3, pct || 0));
    const a = 0.12 + (Math.abs(p) / 3) * 0.55;
    return p >= 0 ? `rgba(16,185,129,${a.toFixed(3)})` : `rgba(239,68,68,${a.toFixed(3)})`;
  }

  // ----- View: historical chart -----
  let histChart = null;
  function findSymbol(sym) {
    if (!stocksData) return null;
    for (const k of ['indexes', 'commodities', 'stocks', 'etfs', 'sectors']) {
      const hit = (stocksData[k] || []).find(r => r.symbol === sym);
      if (hit) return hit;
    }
    return null;
  }

  async function showStockHistory(symbol, range) {
    view = 'history';
    historySymbol = symbol;
    if (range) historyRange = range;
    const meta = findSymbol(symbol);
    const title = meta ? meta.name : symbol;
    renderMarkets($('weatherScrollArea')); // refresh active highlight
    const el = $('marketPanelContent');
    if (!el) return;
    if (typeof showPanel === 'function') showPanel('marketPanel');
    el.innerHTML = panelHeader(title) +
      (meta ? `<p class="market-subtitle">${fmtNum(meta.price)} <span class="${meta.direction}">${arrow(meta.direction)} ${meta.change > 0 ? '+' : ''}${fmtNum(meta.change)} (${meta.changePercent > 0 ? '+' : ''}${meta.changePercent}%)</span></p>` : '') +
      '<div class="market-chart-wrap"><canvas id="histChart"></canvas></div>' +
      '<div class="loading-spinner" id="histLoading">Loading history…</div>';
    try {
      const res = await fetch(`/api/stock-history/${encodeURIComponent(symbol)}?range=${historyRange}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const loading = $('histLoading'); if (loading) loading.remove();
      drawHistChart(data);
    } catch (e) {
      const loading = $('histLoading'); if (loading) loading.textContent = 'History unavailable';
    }
  }

  function drawHistChart(data) {
    const ctx = $('histChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (histChart) histChart.destroy();
    const labels = data.points.map(p => new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const values = data.points.map(p => p.close);
    const up = values.length && values[values.length - 1] >= values[0];
    const line = up ? '#10b981' : '#ef4444';
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const grid = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const tick = isDark ? '#8b95a8' : '#4a5568';
    histChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: line, backgroundColor: line + '22', fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
        scales: {
          x: { grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 8 } },
          y: { grid: { color: grid }, ticks: { color: tick } },
        },
      },
    });
  }

  // ----- Global handlers (used by inline onclick) -----
  window.bizShowHistory = (sym) => showStockHistory(sym);
  window.bizSetRange = (r) => { historyRange = r; if (historySymbol) showStockHistory(historySymbol, r); };
  // Markets column: switch between the quote list and the heat map.
  window.bizToggleMarketView = () => {
    marketsView = marketsView === 'heat' ? 'list' : 'heat';
    renderMarkets($('weatherScrollArea'));
  };
  // Called from the Live Video card and the "CNBC Live" header button. This
  // runs from a real click, so the popup is not blocked.
  window.showCNBCLive = () => {
    const w = openCNBCPopup(CNBC_SITE);
    renderLiveCard(w ? 'opened' : 'blocked');
    if (w) { try { w.focus(); } catch (_) {} }
  };
  window.bizOpenCNBCYouTube = () => {
    const w = openCNBCPopup((liveTv && liveTv.youtubeUrl) || CNBC_SITE);
    if (w) { try { w.focus(); } catch (_) {} }
  };

  // ----- Init -----
  function relabelSidebar() {
    const titleEl = $('weatherSidebarTitle');
    if (titleEl) {
      titleEl.innerHTML = '<svg class="sidebar-logo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M3 16 L7 10 L11 13 L17 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4 H17 V8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> MARKETS';
    }
    // Markets have their own grouping; hide the sports Time/Sport sort.
    const sortCtl = $('weatherEventSortControls');
    if (sortCtl) sortCtl.style.display = 'none';
  }

  function init() {
    relabelSidebar();
    renderMarkets($('weatherScrollArea'));  // loading state

    renderTickerQuotes();                   // ticker loading state

    // Open CNBC Live in its own window on page load. Browsers block
    // window.open() without a user gesture, so if it's blocked the live
    // card offers a one-click "Open CNBC Live" button.
    const popup = openCNBCPopup(CNBC_SITE);
    renderLiveCard(popup ? 'opened' : 'blocked');

    // Resolve CNBC's free YouTube live stream so the card can offer it as a
    // no-sign-in alternative (CNBC.com's channel may want a TV provider).
    fetch('/api/live-tv')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        liveTv = d;
        if (view === 'live') renderLiveCard(popup ? 'opened' : 'blocked');
      })
      .catch(() => {});

    loadStocks();
    setInterval(loadStocks, 5 * 60 * 1000);
    setTimeout(relabelSidebar, 1200);        // re-apply after layout settles
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
