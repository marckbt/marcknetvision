/* BizNews page — Bloomberg-TV-style markets UI.
 *
 * Runs alongside the shared app.js (which provides the news sidebar chrome
 * and the weather ticker). On this page:
 *   • middle column  → market groups: US indices, global indices,
 *                      commodities, major US stocks, ETFs
 *   • main panel     → live business TV (Bloomberg or Fox Business, played
 *                      by the shared live-stream.js like /wx's weather
 *                      feeds; Bloomberg starts on load), or a selected
 *                      symbol's historical chart
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

  const $ = (id) => document.getElementById(id);

  // ----- Live business TV (main panel) -----
  // As on /wx: while a feed plays nothing else takes over the main panel;
  // closing it or popping it out (live-stream.js) frees the panel, which
  // then shows the chart picked meanwhile, if any.
  const STREAM_PANEL = window.mnvLiveStream.PANEL;
  const DEFAULT_FEED = 'bloomberg';
  let lastFeed = DEFAULT_FEED;
  let allowLeaveStream = false;
  const streaming = () => document.body.classList.contains('wx-streaming');

  const baseShowPanel = window.showPanel;
  window.showPanel = function (panelId) {
    if (panelId !== STREAM_PANEL && streaming() && !allowLeaveStream) return;
    allowLeaveStream = false;
    return baseShowPanel.apply(this, arguments);
  };
  function leaveStreamTo(panelId) {
    allowLeaveStream = true;
    window.showPanel(panelId);
  }
  const panelAfterStream = () => (historySymbol ? 'marketPanel' : 'welcomeScreen');

  window.wxCloseStream = () => leaveStreamTo(panelAfterStream());   // stops playback
  window.mnvLiveStream.onPoppedOut = () => leaveStreamTo(panelAfterStream());
  window.mnvLiveStream.onPoppedBack = () => window.showPanel(STREAM_PANEL);

  // Remember the feed last chosen, for the chart header's "Live TV" button.
  const baseShowStream = window.wxShowStream;
  window.wxShowStream = function (key, opts) {
    if (!(opts && opts.reconnect)) { lastFeed = key; view = 'live'; }
    return baseShowStream.call(this, key, opts);
  };
  window.bizShowLive = () => window.wxShowStream(lastFeed);

  // A chart was asked for while a feed holds the panel: point at Pop out.
  function nudgePopOut() {
    const b = document.querySelector('#wxStreamPanel .wx-stream-popout');
    if (!b) return;
    b.classList.remove('wx-stream-popout--nudge');
    void b.offsetWidth;   // restart the animation
    b.classList.add('wx-stream-popout--nudge');
  }
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
          <button class="market-view-btn" onclick="bizShowLive()" title="Watch live business TV">&#9654; Live TV</button>
          ${rangeBtns}
        </div>
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
    // A playing feed keeps the panel; the chart is ready behind it.
    if (streaming()) nudgePopOut();
    else showPanel('marketPanel');
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

    // Live business TV in the main panel from the start (muted, so the
    // browser allows it to autoplay; the video controls unmute).
    window.wxShowStream(DEFAULT_FEED);

    loadStocks();
    setInterval(loadStocks, 5 * 60 * 1000);
    setTimeout(relabelSidebar, 1200);        // re-apply after layout settles
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
