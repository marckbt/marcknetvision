const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Stock-market data for the BizNews page, sourced from Yahoo Finance's
// public chart endpoint (no API key, supports native indices). We fetch each
// symbol's latest quote, cache the whole set to public/data/stocks.json, and
// serve that to the client. Historical series are fetched on demand.
//
// Yahoo's batch /v7/finance/quote endpoint now requires auth, so we hit the
// per-symbol /v8/finance/chart endpoint (which does not) with limited
// concurrency.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// Market indices — US listed first (region 'US'), then common foreign markets
// (region 'Intl'). name is our display label; ticker is a short badge.
const INDICES = [
  { symbol: '^GSPC',     name: 'S&P 500',        ticker: 'SPX',    region: 'US' },
  { symbol: '^DJI',      name: 'Dow Jones',      ticker: 'DJIA',   region: 'US' },
  { symbol: '^IXIC',     name: 'Nasdaq',         ticker: 'IXIC',   region: 'US' },
  { symbol: '^RUT',      name: 'Russell 2000',   ticker: 'RUT',    region: 'US' },
  { symbol: '^FTSE',     name: 'FTSE 100',       ticker: 'UK',     region: 'Intl' },
  { symbol: '^GDAXI',    name: 'DAX',            ticker: 'DE',     region: 'Intl' },
  { symbol: '^FCHI',     name: 'CAC 40',         ticker: 'FR',     region: 'Intl' },
  { symbol: '^STOXX50E', name: 'Euro Stoxx 50',  ticker: 'EU',     region: 'Intl' },
  { symbol: '^N225',     name: 'Nikkei 225',     ticker: 'JP',     region: 'Intl' },
  { symbol: '^HSI',      name: 'Hang Seng',      ticker: 'HK',     region: 'Intl' },
  { symbol: '000001.SS', name: 'Shanghai',       ticker: 'CN',     region: 'Intl' },
  { symbol: '^GSPTSE',   name: 'S&P/TSX',        ticker: 'CA',     region: 'Intl' },
  { symbol: '^AXJO',     name: 'ASX 200',        ticker: 'AU',     region: 'Intl' },
  { symbol: '^BSESN',    name: 'Sensex',         ticker: 'IN',     region: 'Intl' },
  { symbol: '^BVSP',     name: 'Bovespa',        ticker: 'BR',     region: 'Intl' },
  { symbol: '^KS11',     name: 'KOSPI',          ticker: 'KR',     region: 'Intl' },
];

// Commodities (Yahoo continuous-front futures).
const COMMODITIES = [
  { symbol: 'GC=F', name: 'Gold',        ticker: 'GC' },
  { symbol: 'SI=F', name: 'Silver',      ticker: 'SI' },
  { symbol: 'CL=F', name: 'Crude (WTI)', ticker: 'CL' },
  { symbol: 'BZ=F', name: 'Brent Crude', ticker: 'BZ' },
  { symbol: 'NG=F', name: 'Natural Gas', ticker: 'NG' },
  { symbol: 'HG=F', name: 'Copper',      ticker: 'HG' },
  { symbol: 'ZC=F', name: 'Corn',        ticker: 'ZC' },
  { symbol: 'ZW=F', name: 'Wheat',       ticker: 'ZW' },
  { symbol: 'ZS=F', name: 'Soybeans',    ticker: 'ZS' },
  { symbol: 'KC=F', name: 'Coffee',      ticker: 'KC' },
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
async function yahooGet(url, retries = 4) {
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

// Fetch a definition list into display rows. Yahoo 429s on bursts, so we
// use a small worker pool (2) with a stagger between requests — gentle
// enough to avoid rate limiting, quick enough that a full refresh of all
// ~60 symbols finishes in roughly 15 seconds.
const FETCH_CONCURRENCY = 2;
const FETCH_STAGGER_MS = 300;

async function fetchList(defs) {
  const out = new Array(defs.length);
  let next = 0;
  async function worker(slot) {
    await sleep(slot * (FETCH_STAGGER_MS / FETCH_CONCURRENCY));
    while (next < defs.length) {
      const i = next++;
      const d = defs[i];
      try {
        const q = await fetchQuote(d.symbol);
        out[i] = { ...d, ...q, ok: true };
      } catch (e) {
        out[i] = { ...d, ok: false, price: null, change: null, changePercent: null, direction: 'flat' };
      }
      await sleep(FETCH_STAGGER_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, defs.length) }, (_, s) => worker(s)));
  return out;
}

// Main: refresh all market data and write public/data/stocks.json.
async function refreshStocks() {
  console.log('[Stocks] Refreshing market data...');
  // Groups fetched sequentially so the overall request rate stays gentle.
  const indexes = await fetchList(INDICES);
  const commodities = await fetchList(COMMODITIES);
  const stocks = await fetchList(STOCKS);
  const etfs = await fetchList(ETFS);
  const sectors = await fetchList(SECTORS);
  const okCount = (a) => a.filter(x => x.ok).length;
  console.log(`[Stocks] indices ${okCount(indexes)}/${indexes.length}, commodities ${okCount(commodities)}/${commodities.length}, stocks ${okCount(stocks)}/${stocks.length}, etfs ${okCount(etfs)}/${etfs.length}, sectors ${okCount(sectors)}/${sectors.length} OK`);

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
  const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
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
