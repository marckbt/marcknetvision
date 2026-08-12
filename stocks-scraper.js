const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Stock-market data for the BizNews page.
//
// QUOTES come from CNBC's public quote service, which takes many symbols per
// request (no API key). That matters: Yahoo's per-symbol chart endpoint needs
// ~60 requests per refresh and rate-limits (HTTP 429) well below that, which
// left rows blank. CNBC covers all our indices, commodity futures, stocks and
// ETFs in 5 batched requests.
//
// Yahoo remains the source for on-demand HISTORY (fetchStockHistory) — that's
// one request per user click, nowhere near a rate limit — and as a per-symbol
// fallback if CNBC ever omits a quote. Anything still missing keeps its last
// known value (carryForward) so the page never blanks out.
//
// Each instrument carries two ids: `symbol` (Yahoo, used for history + as the
// UI's key) and `cnbc` (used for quotes).

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CNBC_QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

// Market indices — US listed first (region 'US'), then common foreign markets
// (region 'Intl'). name is our display label; ticker is a short badge.
const INDICES = [
  { symbol: '^GSPC',     cnbc: '.SPX',      name: 'S&P 500',       ticker: 'SPX',  region: 'US' },
  { symbol: '^DJI',      cnbc: '.DJI',      name: 'Dow Jones',     ticker: 'DJIA', region: 'US' },
  { symbol: '^IXIC',     cnbc: '.IXIC',     name: 'Nasdaq',        ticker: 'IXIC', region: 'US' },
  { symbol: '^RUT',      cnbc: '.RUT',      name: 'Russell 2000',  ticker: 'RUT',  region: 'US' },
  { symbol: '^FTSE',     cnbc: '.FTSE',     name: 'FTSE 100',      ticker: 'UK',   region: 'Intl' },
  { symbol: '^GDAXI',    cnbc: '.GDAXI',    name: 'DAX',           ticker: 'DE',   region: 'Intl' },
  { symbol: '^FCHI',     cnbc: '.FCHI',     name: 'CAC 40',        ticker: 'FR',   region: 'Intl' },
  { symbol: '^STOXX50E', cnbc: '.STOXX50E', name: 'Euro Stoxx 50', ticker: 'EU',   region: 'Intl' },
  { symbol: '^N225',     cnbc: '.N225',     name: 'Nikkei 225',    ticker: 'JP',   region: 'Intl' },
  { symbol: '^HSI',      cnbc: '.HSI',      name: 'Hang Seng',     ticker: 'HK',   region: 'Intl' },
  { symbol: '000001.SS', cnbc: '.SSEC',     name: 'Shanghai',      ticker: 'CN',   region: 'Intl' },
  { symbol: '^GSPTSE',   cnbc: '.GSPTSE',   name: 'S&P/TSX',       ticker: 'CA',   region: 'Intl' },
  { symbol: '^AXJO',     cnbc: '.AXJO',     name: 'ASX 200',       ticker: 'AU',   region: 'Intl' },
  // CNBC carries NIFTY 50 rather than the Sensex for India.
  { symbol: '^NSEI',     cnbc: '.NSEI',     name: 'NIFTY 50',      ticker: 'IN',   region: 'Intl' },
  { symbol: '^BVSP',     cnbc: '.BVSP',     name: 'Bovespa',       ticker: 'BR',   region: 'Intl' },
  { symbol: '^KS11',     cnbc: '.KS11',     name: 'KOSPI',         ticker: 'KR',   region: 'Intl' },
];

// Commodities — front-month futures (Yahoo symbol for history, CNBC for quotes).
const COMMODITIES = [
  { symbol: 'GC=F', cnbc: '@GC.1',  name: 'Gold',        ticker: 'GC' },
  { symbol: 'SI=F', cnbc: '@SI.1',  name: 'Silver',      ticker: 'SI' },
  { symbol: 'CL=F', cnbc: '@CL.1',  name: 'Crude (WTI)', ticker: 'CL' },
  { symbol: 'BZ=F', cnbc: '@LCO.1', name: 'Brent Crude', ticker: 'BZ' },
  { symbol: 'NG=F', cnbc: '@NG.1',  name: 'Natural Gas', ticker: 'NG' },
  { symbol: 'HG=F', cnbc: '@HG.1',  name: 'Copper',      ticker: 'HG' },
  { symbol: 'ZC=F', cnbc: '@C.1',   name: 'Corn',        ticker: 'ZC' },
  { symbol: 'ZW=F', cnbc: '@W.1',   name: 'Wheat',       ticker: 'ZW' },
  { symbol: 'ZS=F', cnbc: '@S.1',   name: 'Soybeans',    ticker: 'ZS' },
  { symbol: 'KC=F', cnbc: '@KC.1',  name: 'Coffee',      ticker: 'KC' },
];

// Major US stocks (largest / most-watched names).
const STOCKS = [
  { symbol: 'AAPL',  name: 'Apple',        ticker: 'AAPL' },
  { symbol: 'MSFT',  name: 'Microsoft',    ticker: 'MSFT' },
  { symbol: 'NVDA',  name: 'NVIDIA',       ticker: 'NVDA' },
  { symbol: 'AMZN',  name: 'Amazon',       ticker: 'AMZN' },
  { symbol: 'GOOGL', name: 'Alphabet',     ticker: 'GOOGL' },
  { symbol: 'META',  name: 'Meta',         ticker: 'META' },
  { symbol: 'TSLA',  name: 'Tesla',        ticker: 'TSLA' },
  { symbol: 'AVGO',  name: 'Broadcom',     ticker: 'AVGO' },
  { symbol: 'BRK-B', name: 'Berkshire',    ticker: 'BRK.B' },
  { symbol: 'JPM',   name: 'JPMorgan',     ticker: 'JPM' },
  { symbol: 'LLY',   name: 'Eli Lilly',    ticker: 'LLY' },
  { symbol: 'WMT',   name: 'Walmart',      ticker: 'WMT' },
  { symbol: 'XOM',   name: 'Exxon Mobil',  ticker: 'XOM' },
  { symbol: 'V',     name: 'Visa',         ticker: 'V' },
];

// Widely-held ETFs.
const ETFS = [
  { symbol: 'SPY',  name: 'S&P 500 ETF',      ticker: 'SPY' },
  { symbol: 'QQQ',  name: 'Nasdaq 100 ETF',   ticker: 'QQQ' },
  { symbol: 'DIA',  name: 'Dow ETF',          ticker: 'DIA' },
  { symbol: 'IWM',  name: 'Russell 2000 ETF', ticker: 'IWM' },
  { symbol: 'VTI',  name: 'Total Market',     ticker: 'VTI' },
  { symbol: 'GLD',  name: 'Gold Trust',       ticker: 'GLD' },
  { symbol: 'TLT',  name: '20Y Treasury',     ticker: 'TLT' },
  { symbol: 'EEM',  name: 'Emerging Markets', ticker: 'EEM' },
];

// US S&P 500 sector SPDR ETFs — used as proxies for the sector heat map.
const SECTORS = [
  { symbol: 'XLK',  name: 'Technology' },
  { symbol: 'XLF',  name: 'Financials' },
  { symbol: 'XLV',  name: 'Health Care' },
  { symbol: 'XLY',  name: 'Consumer Discretionary' },
  { symbol: 'XLC',  name: 'Communication Svcs' },
  { symbol: 'XLI',  name: 'Industrials' },
  { symbol: 'XLP',  name: 'Consumer Staples' },
  { symbol: 'XLE',  name: 'Energy' },
  { symbol: 'XLU',  name: 'Utilities' },
  { symbol: 'XLB',  name: 'Materials' },
  { symbol: 'XLRE', name: 'Real Estate' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// GET a Yahoo chart URL, retrying on HTTP 429 (rate limited) with backoff.
// Retries are deliberately few: with ~60 symbols per cycle, long retry
// chains stall the whole refresh. A symbol that stays throttled keeps its
// previous value via carryForward() and gets another try next cycle.
async function yahooGet(url, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      await sleep(Number.isFinite(ra) ? ra * 1000 : 2000 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

// Fetch the latest quote for one symbol via the chart endpoint.
async function fetchQuote(symbol) {
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const data = await yahooGet(url);
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error('no meta');
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  return {
    price: Math.round(price * 100) / 100,
    prevClose: Math.round(prev * 100) / 100,
    change: Math.round(change * 100) / 100,
    changePercent: Math.round(changePct * 100) / 100,
    direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat'),
    currency: meta.currency || '',
  };
}

// Stocks / ETFs / sector ETFs use the same ticker on both services; only
// Berkshire's class-B share differs (CNBC writes it with a dot).
const cnbcFor = (d) => d.cnbc || (d.symbol === 'BRK-B' ? 'BRK.B' : d.symbol);

const round2 = (n) => Math.round(n * 100) / 100;
// CNBC returns display strings ("7,728.20", "-0.32%") — parse to numbers.
const parseNum = (s) => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Fetch quotes for a whole group in ONE request from CNBC.
// Returns a map keyed by the CNBC symbol.
async function fetchCnbcQuotes(defs) {
  const syms = defs.map(cnbcFor).filter(Boolean);
  if (!syms.length) return {};
  const url = `${CNBC_QUOTE_URL}?symbols=${encodeURIComponent(syms.join('|'))}`
            + '&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1';
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`CNBC HTTP ${res.status}`);
  const data = await res.json();
  const result = data.FormattedQuoteResult || data.QuickQuoteResult || {};
  let rows = result.FormattedQuote || result.QuickQuote || [];
  if (!Array.isArray(rows)) rows = [rows];

  const out = {};
  for (const q of rows) {
    if (!q || !q.symbol) continue;
    const price = parseNum(q.last);
    if (price == null) continue;
    const prevClose = parseNum(q.previous_day_closing);
    let change = parseNum(q.change);
    let pct = parseNum(q.change_pct);
    if (change == null && prevClose != null) change = price - prevClose;
    if (pct == null && prevClose) pct = ((price - prevClose) / prevClose) * 100;
    out[q.symbol] = {
      price: round2(price),
      prevClose: prevClose != null ? round2(prevClose) : null,
      change: change != null ? round2(change) : null,
      changePercent: pct != null ? round2(pct) : null,
      direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat'),
      currency: q.currencyCode || '',
    };
  }
  return out;
}

// Build a group's rows: one batched CNBC request, then Yahoo per-symbol for
// anything CNBC didn't return, then last-known values for anything still
// missing so the page never blanks out.
const FETCH_DELAY_MS = 700;

async function fetchList(defs, prev) {
  let quotes = {};
  try {
    quotes = await fetchCnbcQuotes(defs);
  } catch (e) {
    console.error(`[Stocks] CNBC batch failed (${e.message}) — falling back to per-symbol`);
  }

  const out = [];
  let fallbacks = 0;
  for (const d of defs) {
    const q = quotes[cnbcFor(d)];
    if (q) { out.push({ ...d, ...q, ok: true, stale: false }); continue; }
    // Not in the batch — try Yahoo for this one symbol.
    try {
      if (fallbacks++ > 0) await sleep(FETCH_DELAY_MS);
      const yq = await fetchQuote(d.symbol);
      out.push({ ...d, ...yq, ok: true, stale: false });
    } catch (e) {
      out.push(carryForward(d, prev, e));
    }
  }
  return out;
}

// Build a row for a symbol we couldn't fetch this cycle: reuse the last
// known quote (marked stale) rather than emitting an empty row, so a
// transient 429 doesn't wipe the value off the page.
function carryForward(def, prev, err) {
  const last = prev && prev[def.symbol];
  if (last && last.price != null) {
    return {
      ...def,
      price: last.price,
      prevClose: last.prevClose,
      change: last.change,
      changePercent: last.changePercent,
      direction: last.direction || 'flat',
      currency: last.currency || '',
      ok: true,
      stale: true,
      asOf: last.asOf || prev.__lastUpdated || null,
    };
  }
  return { ...def, ok: false, stale: true, price: null, change: null, changePercent: null, direction: 'flat' };
}

// Index the previously-saved quotes by symbol so failed fetches can reuse them.
function loadPrevious() {
  try {
    const p = path.join(__dirname, 'public', 'data', 'stocks.json');
    if (!fs.existsSync(p)) return null;
    const saved = JSON.parse(fs.readFileSync(p, 'utf8'));
    const map = { __lastUpdated: saved.lastUpdated || null };
    for (const key of ['indexes', 'commodities', 'stocks', 'etfs', 'sectors']) {
      for (const row of saved[key] || []) {
        if (row && row.symbol) map[row.symbol] = row;
      }
    }
    return map;
  } catch (e) {
    return null;
  }
}

// Main: refresh all market data and write public/data/stocks.json.
async function refreshStocks() {
  console.log('[Stocks] Refreshing market data...');
  const prev = loadPrevious();
  // Groups fetched sequentially so the overall request rate stays gentle.
  const indexes = await fetchList(INDICES, prev);
  const commodities = await fetchList(COMMODITIES, prev);
  const stocks = await fetchList(STOCKS, prev);
  const etfs = await fetchList(ETFS, prev);
  const sectors = await fetchList(SECTORS, prev);

  const all = [...indexes, ...commodities, ...stocks, ...etfs, ...sectors];
  const fresh = all.filter(x => x.ok && !x.stale).length;
  const carried = all.filter(x => x.stale && x.price != null).length;
  const missing = all.filter(x => x.price == null).length;
  console.log(`[Stocks] ${fresh} fresh, ${carried} carried forward (rate limited), ${missing} unavailable, of ${all.length}`);
  if (missing > 0) {
    console.log('[Stocks] no data yet for: ' + all.filter(x => x.price == null).map(x => x.symbol).join(', '));
  }

  const result = { lastUpdated: new Date().toISOString(), indexes, commodities, stocks, etfs, sectors };
  const outPath = path.join(__dirname, 'public', 'data', 'stocks.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`[Stocks] Saved to ${outPath}`);
  return result;
}

// Historical daily closes for a symbol (for the on-select chart). Returns
// { symbol, name, range, points:[{ t (ISO), close }] }.
async function fetchStockHistory(symbol, range = '1mo') {
  const allowed = new Set(['5d', '1mo', '3mo', '6mo', '1y', '5y']);
  const r = allowed.has(range) ? range : '1mo';
  const interval = (r === '1y' || r === '5y') ? '1wk' : '1d';
  const url = `${CHART_URL}${encodeURIComponent(symbol)}?interval=${interval}&range=${r}`;
  // Route through yahooGet so a transient 429 is retried with backoff rather
  // than surfacing as "History unavailable" on the first hiccup.
  const data = await yahooGet(url);
  const result = data.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] == null) continue;
    points.push({ t: new Date(ts[i] * 1000).toISOString(), close: Math.round(closes[i] * 100) / 100 });
  }
  return { symbol, name: result?.meta?.shortName || symbol, range: r, points };
}

module.exports = { refreshStocks, fetchStockHistory, INDICES, SECTORS, COMMODITIES, STOCKS, ETFS };

// Run directly for testing: `node stocks-scraper.js`
if (require.main === module) {
  refreshStocks().then(d => {
    const arrow = (x) => x.direction === 'up' ? '▲' : x.direction === 'down' ? '▼' : '–';
    const dump = (label, rows) => {
      console.log(`\n${label}:`);
      rows.forEach(r => console.log(`  ${r.name.padEnd(22)} ${String(r.price ?? '--').padStart(11)}  ${arrow(r)} ${r.changePercent ?? '--'}%`));
    };
    dump('Indices', d.indexes);
    dump('Commodities', d.commodities);
    dump('Stocks', d.stocks);
    dump('ETFs', d.etfs);
    dump('Sectors', d.sectors);
  });
}
