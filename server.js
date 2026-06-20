const express = require('express');
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');

const { refreshWeather, fetchNWSAlerts } = require('./weather-scraper');
const { refreshSchedule } = require('./schedule-scraper');
const { refreshWorldWeather } = require('./world-weather-scraper');

const app = express();
const PORT = process.env.PORT || 3000;
// rss-parser sees default RSS/Atom fields out of the box (enclosure,
// itunes:image, etc.) but skips the Media RSS namespace unless asked.
// We register media:thumbnail and media:content so feeds like The Verge,
// Engadget, BBC, etc. that publish images via <media:thumbnail url="…"/>
// or <media:content medium="image" url="…"/> can populate item.thumbnail.
const parser = new RSSParser({
  customFields: {
    item: [
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:group', 'mediaGroup'],
    ],
  },
});

// Reddit blocks rss-parser's built-in HTTP client (403/429) even with a
// browser User-Agent — its request signature differs from a normal
// browser/fetch. node-fetch, however, gets a clean 200. So for any
// reddit.com feed we fetch the XML ourselves and hand the string to the
// parser; everything else uses the parser's own parseURL().
const REDDIT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
function isRedditUrl(url) {
  return /(^|\.)reddit\.com/i.test(url || '');
}
async function fetchAndParseFeed(url) {
  if (isRedditUrl(url)) {
    const xml = await fetchRedditXml(url);
    return parser.parseString(xml);
  }
  return parser.parseURL(url);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Fetch a reddit URL as text, retrying on HTTP 429/403 (rate limited /
// throttled) with a backoff that respects the Retry-After header when
// present. Reddit returns both codes when it's throttling an IP.
async function fetchRedditXml(url, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      timeout: 15000,
      headers: {
        'User-Agent': REDDIT_UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });
    if (res.ok) return res.text();
    if ((res.status === 429 || res.status === 403) && attempt < retries) {
      const ra = parseInt(res.headers.get('retry-after') || '', 10);
      const waitMs = Number.isFinite(ra) ? ra * 1000 : 2000 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

// Reddit rate-limits per-IP aggressively, so fetching 100+ subreddit RSS
// feeds individually trips HTTP 429 and the whole category comes back
// empty. Instead we COMBINE subreddits into "multireddit" feeds —
// https://www.reddit.com/r/a+b+c/.rss returns one merged feed — cutting
// ~130 requests down to a handful (REDDIT_BATCH_SIZE subs per request).
// Each entry's subreddit is recovered from its link so the per-sub
// "r/<name>" source label is preserved. User feeds (u/...) can't be
// combined, so the few of them are fetched individually.
const REDDIT_BATCH_SIZE = 25;
const REDDIT_BATCH_DELAY_MS = 1500; // pause between batch requests

async function fetchRedditCategory(feeds, maxAgeMs) {
  // lowercase sub -> display name (preserve reddit-feeds.json casing)
  const subDisplay = new Map();
  const subNames = [];
  const userFeeds = [];
  for (const f of feeds) {
    const m = /\/r\/([^/]+)\//i.exec(f.url || '');
    if (m) {
      // A feed url may itself be a custom multi ("foo+bar"); split it.
      m[1].split('+').forEach(n => {
        const key = n.toLowerCase();
        if (!subDisplay.has(key)) { subDisplay.set(key, n); subNames.push(n); }
      });
    } else if (/\/user\//i.test(f.url || '')) {
      userFeeds.push(f);
    }
  }

  const redditFavicon = resolveFavicon('https://www.reddit.com/', null);
  const articles = [];
  let dropped = 0;

  const pushEntry = (item, sourceName) => {
    const pubDate = item.pubDate || item.isoDate || '';
    if (!isFresh(pubDate, maxAgeMs)) { dropped++; return; }
    articles.push({
      source: sourceName,
      favicon: redditFavicon,
      thumbnail: extractThumbnail(item),
      title: item.title || 'Untitled',
      link: item.link || '#',
      pubDate,
      snippet: (item.contentSnippet || item.content || '').substring(0, 200),
    });
  };

  // Batch subreddits into multireddit feeds, fetched sequentially with a
  // small pause between requests so we stay gentle on the rate limiter.
  const batches = [];
  for (let i = 0; i < subNames.length; i += REDDIT_BATCH_SIZE) {
    batches.push(subNames.slice(i, i + REDDIT_BATCH_SIZE));
  }
  let consecutiveFails = 0;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const url = `https://www.reddit.com/r/${batch.join('+')}/.rss`;
    try {
      const parsed = await parser.parseString(await fetchRedditXml(url));
      (parsed.items || []).forEach(item => {
        const sm = /\/r\/([^/]+)\//i.exec(item.link || '');
        const key = sm ? sm[1].toLowerCase() : '';
        const display = subDisplay.get(key) || (sm ? sm[1] : 'reddit');
        pushEntry(item, `r/${display}`);
      });
      consecutiveFails = 0;
    } catch (e) {
      consecutiveFails++;
      console.log(`Failed to fetch reddit batch [${batch.slice(0, 3).join(',')}…]: ${e.message}`);
      // If the first couple of batches both fail, the IP is being rate
      // limited — bail out fast rather than grinding through every batch
      // (and timing out the request). The caller falls back to the disk
      // cache so the section still shows recent content.
      if (consecutiveFails >= 2) {
        console.log('[news/Reddit] rate limited — aborting remaining batches, will use cache');
        break;
      }
    }
    if (b < batches.length - 1) await sleep(REDDIT_BATCH_DELAY_MS);
  }

  // User feeds individually (only a few), sequential with retry.
  for (const f of userFeeds) {
    try {
      const parsed = await parser.parseString(await fetchRedditXml(f.url));
      (parsed.items || []).forEach(item => pushEntry(item, f.name));
    } catch (e) {
      console.log(`Failed to fetch ${f.name}: ${e.message}`);
    }
  }

  return { articles, dropped };
}

// --- Favicon resolution ----------------------------------------------------
// Each article we return gets a `favicon` URL so the client can render an
// icon next to the source name. Resolution order:
//   1. The parsed feed's own image/icon (RSS <image><url>, Atom <icon>,
//      Atom <logo>) — most legit news feeds populate one of these.
//   2. Google's S2 favicon service, keyed off the feed URL's host. Works
//      for any public site without us needing to scrape /favicon.ico.
// Reddit subreddit feeds expose no per-sub icon and all share reddit.com
// as their host, so they all get the same reddit favicon — that's the
// expected behavior; the source label ("r/foo") still differentiates them.
function resolveFavicon(feedUrl, parsedFeed) {
  // Prefer feed-declared image. rss-parser surfaces RSS <image><url> as
  // feed.image.url and Atom <icon>/<logo> as feed.icon / feed.image.
  const declared =
    parsedFeed?.image?.url ||
    parsedFeed?.image?.link ||
    parsedFeed?.icon ||
    '';
  if (declared && /^https?:\/\//i.test(declared)) return declared;

  // Fallback: Google S2 by host. 32px renders crisply at the 14-16px
  // sizes the UI uses without looking pixelated on retina.
  try {
    const host = new URL(feedUrl).hostname;
    if (host) return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch (_) { /* unparseable URL — give up silently */ }
  return '';
}

// --- Article thumbnail extraction ------------------------------------------
// Pull a single representative image URL out of an RSS/Atom item. Tries
// the common sources in order of reliability:
//   1. media:thumbnail / media:content (Media RSS namespace)
//   2. enclosure (any image/* MIME)
//   3. itunes:image (some publishers use it for articles too)
//   4. first <img src="…"> inside the item's content/description HTML
// Returns '' when nothing usable is found — the client renders no
// thumbnail in that case (it never falls back to a generic placeholder).
function extractThumbnail(item) {
  const fromMedia = (arr) => {
    if (!Array.isArray(arr)) return '';
    for (const m of arr) {
      const url = m?.$?.url || m?.url;
      const medium = (m?.$?.medium || '').toLowerCase();
      const type = (m?.$?.type || '').toLowerCase();
      if (!url) continue;
      // media:content can carry video too — filter to images.
      if (medium && medium !== 'image') continue;
      if (type && !type.startsWith('image/')) continue;
      if (/^https?:\/\//i.test(url)) return url;
    }
    return '';
  };

  // 1) media:thumbnail
  let url = fromMedia(item.mediaThumbnail);
  if (url) return url;

  // 2) media:content (direct, or nested inside media:group)
  url = fromMedia(item.mediaContent);
  if (url) return url;
  const groupContent = item.mediaGroup?.['media:content'];
  if (groupContent) {
    url = fromMedia(Array.isArray(groupContent) ? groupContent : [groupContent]);
    if (url) return url;
  }

  // 3) enclosure (rss-parser surfaces this as item.enclosure)
  const enc = item.enclosure;
  if (enc?.url && (enc.type || '').toLowerCase().startsWith('image/')) {
    return enc.url;
  }

  // 4) itunes:image (rss-parser exposes as itunes.image on items it
  //    matches; safe even when the field isn't present).
  if (item.itunes?.image && /^https?:\/\//i.test(item.itunes.image)) {
    return item.itunes.image;
  }

  // 5) First <img src="…"> inside content or content:encoded. Many
  //    publishers stuff the hero image into the body HTML even when
  //    they don't bother with Media RSS.
  const html = item['content:encoded'] || item.content || item.contentSnippet || '';
  if (typeof html === 'string') {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && /^https?:\/\//i.test(m[1])) return m[1];
  }

  return '';
}

// --- RSS freshness window --------------------------------------------------
// Drop any story whose publish date is older than the category's window,
// both when we ingest items from a feed and when we serve from the
// in-memory cache. Keeps panels focused on recent content and bounds
// memory as the cache turns over.
const MAX_ARTICLE_AGE_DAYS = 5;
const MAX_ARTICLE_AGE_MS = MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000;

// Per-category overrides for how many items to keep per feed and how old
// an item may be. Anything not listed uses DEFAULT_CATEGORY_LIMITS.
const DEFAULT_CATEGORY_LIMITS = { perFeed: 5, maxAgeMs: MAX_ARTICLE_AGE_MS };
const CATEGORY_LIMITS = {
  // Reddit: at most 10 posts per subreddit, nothing older than 48 hours.
  Reddit: { perFeed: 10, maxAgeMs: 48 * 60 * 60 * 1000 },
};
function limitsFor(category) {
  return CATEGORY_LIMITS[category] || DEFAULT_CATEGORY_LIMITS;
}

// Returns true if the item's pubDate is within maxAgeMs of now. Items
// with no/unparseable date are rejected — we'd rather drop an undateable
// item than store one that might be ancient.
function isFresh(pubDateValue, maxAgeMs = MAX_ARTICLE_AGE_MS) {
  if (!pubDateValue) return false;
  const t = new Date(pubDateValue).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) <= maxAgeMs;
}

// --- Reddit subreddit list (maintained in reddit-feeds.json) ---------------
const REDDIT_FEEDS_PATH = path.join(__dirname, 'reddit-feeds.json');

// Read reddit-feeds.json and turn it into the same [{name,url}] shape the
// other categories use. Accepts plain subreddit strings ("delta") or
// {name,url} objects for custom/multireddit feeds. Returns [] on any error
// so a malformed file never crashes the server.
function loadRedditFeeds() {
  try {
    const raw = JSON.parse(fs.readFileSync(REDDIT_FEEDS_PATH, 'utf8'));
    const entries = Array.isArray(raw) ? raw : (raw.subreddits || []);
    const feeds = [];
    for (const e of entries) {
      if (typeof e === 'string') {
        const slug = e.trim().replace(/^\/?r\//i, '').replace(/\/+$/,'');
        if (!slug) continue;
        feeds.push({ name: `r/${slug}`, url: `https://www.reddit.com/r/${slug}/.rss` });
      } else if (e && e.url) {
        feeds.push({ name: e.name || e.url, url: e.url });
      }
    }
    console.log(`[Reddit] Loaded ${feeds.length} subreddit feed(s) from reddit-feeds.json`);
    return feeds;
  } catch (e) {
    console.error(`[Reddit] Could not load reddit-feeds.json: ${e.message}`);
    return [];
  }
}

// --- Build version for cache-busting ---------------------------------------
// The biggest cause of "my changes aren't deploying" is a browser or CDN
// serving a stale app.js / style.css after a new image is built. We stamp
// those asset URLs in index.html with ?v=<BUILD_ID>, where BUILD_ID is the
// newest mtime of the front-end files. A fresh Docker build re-COPYs those
// files with new mtimes, so BUILD_ID changes and every client is forced to
// re-fetch them. Override with the BUILD_ID env var if you prefer a git SHA.
function computeBuildId() {
  let newest = 0;
  for (const f of ['public/app.js', 'public/style.css', 'public/index.html']) {
    try { newest = Math.max(newest, fs.statSync(path.join(__dirname, f)).mtimeMs); }
    catch (_) { /* ignore missing file */ }
  }
  return newest ? String(Math.floor(newest)) : String(Date.now());
}
const BUILD_ID = process.env.BUILD_ID || computeBuildId();
const SERVER_STARTED_AT = new Date().toISOString();
console.log(`[Server] Asset build id: ${BUILD_ID}`);

// Serve index.html with cache-busted asset URLs and a no-cache header on
// the HTML document itself, so a new deploy is always picked up. Registered
// BEFORE express.static so it wins for "/" and "/index.html".
function serveIndex(req, res) {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) => {
    if (err) return res.status(500).send('index.html not found');
    const out = html
      .replace('href="style.css"', `href="style.css?v=${BUILD_ID}"`)
      .replace('src="app.js"', `src="app.js?v=${BUILD_ID}"`);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(out);
  });
}
app.get('/', serveIndex);
app.get('/index.html', serveIndex);

// Version / feature probe — hit this to confirm which build is actually
// running inside the container (bypasses all browser caching):
//   curl http://localhost:3000/api/version
// `features` are computed by inspecting the live files on disk, so they
// reflect exactly what this process is serving.
app.get('/api/version', (req, res) => {
  const has = (file, needle) => {
    try { return fs.readFileSync(path.join(__dirname, file), 'utf8').includes(needle); }
    catch (_) { return false; }
  };
  res.set('Cache-Control', 'no-store');
  res.json({
    buildId: BUILD_ID,
    startedAt: SERVER_STARTED_AT,
    features: {
      worldWeather: has('public/index.html', 'data-location="world"') &&
                    fs.existsSync(path.join(__dirname, 'world-weather-scraper.js')),
      hamburgerMenu: has('public/index.html', 'id="mobileMenuToggle"'),
      cacheBusting: true,
    },
  });
});

app.use(express.static('public'));
app.use('/archive', express.static('Archive'));

// Serve the OPML feeds file
const OPML_PATH = path.join(__dirname, 'Inoreader Feeds 20260325.xml');

// RSS Feed sources parsed from OPML
const FEED_CATEGORIES = {
  Tech: [
    { name: 'The Hacker News', url: 'https://thehackernews.com/feeds/posts/default' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
    { name: 'Slashdot', url: 'https://rss.slashdot.org/Slashdot/slashdot' },
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml' },
    { name: '9to5Mac', url: 'https://9to5mac.com/feed/' },
    { name: 'MacRumors', url: 'https://feeds.macrumors.com/MacRumors-All' },
    { name: 'Schneier on Security', url: 'https://www.schneier.com/blog/index.rdf' },
    { name: 'MakeUseOf', url: 'https://www.makeuseof.com/feed/' },
    { name: 'Lifehacker', url: 'https://lifehacker.com/feed' },
    { name: 'Reddit Front Page', url: 'https://www.reddit.com/.rss' },
    { name: 'The Register', url: 'https://www.theregister.co.uk/headlines.rss' },
    { name: 'Mashable', url: 'https://mashable.com/feeds/rss/entertainment' },
    { name: 'Uncrate', url: 'https://feeds.feedburner.com/uncrate' },
    { name: 'Phone Scoop', url: 'https://www.phonescoop.com/rss/news.php' },
    { name: 'Slickdeals', url: 'https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1' },
    { name: 'Deutsche Welle', url: 'http://rss.dw.de/rdf/rss-en-all' },
    { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml?edition=uk' },
    { name: 'Fark', url: 'https://www.fark.com/fark.rss' },
    { name: 'Ask MetaFilter', url: 'https://ask.metafilter.com/rss.xml' },
    { name: 'DSLReports', url: 'http://www.broadbandreports.com/rss20.xml' },
    { name: 'BGR', url: 'https://feeds.feedburner.com/TheBoyGeniusReport' },
    { name: 'Laptopmag', url: 'https://www.laptopmag.com/feeds/all' },
  ],
  Aviation: [
    { name: 'World Airline News', url: 'https://worldairlinenews.com/feed/' },
    { name: 'Skift', url: 'https://skift.com/feed/' },
    { name: 'BoardingArea', url: 'https://boardingarea.com/feed/' },
    { name: 'The Flight Deal', url: 'https://feeds.feedburner.com/TheFlightDeal' },
    { name: 'AskThePilot', url: 'https://www.askthepilot.com/feed/' },
    { name: 'Airliners.net (Forum 1)', url: 'https://www.airliners.net/forum/feed.php?f=3&t=1506889' },
    { name: 'Airliners.net (Forum 2)', url: 'https://www.airliners.net/forum/feed.php?f=3&t=1498987' },
    { name: 'Eye of the Flyer', url: 'https://deltamileagerun.boardingarea.com/feed/' },
    { name: 'Andy\'s Travel Blog', url: 'https://andystravelblog.com/feed/' },
    { name: 'MileValue', url: 'https://milevalue.com/feed/' },
    { name: 'FlyerTalk Delta', url: 'https://www.flyertalk.com/forum/external.php?type=RSS2&forumids=665' },
    { name: 'FlyerTalk United', url: 'https://www.flyertalk.com/forum/external.php?type=RSS2&forumids=681' },
{ name: 'Points Miles & Martinis', url: 'https://pointsmilesandmartinis.boardingarea.com/feed/' },
    { name: 'FlyerTalk Premium Fares', url: 'https://www.flyertalk.com/forum/external.php?type=RSS2&forumids=740' },
    { name: 'Frequent Business Traveler', url: 'https://www.frequentbusinesstraveler.com/feed/' },
    { name: 'Jeffsetter Travel', url: 'http://feeds.feedburner.com/jeffsettertravel' },
    { name: 'Points with a Crew', url: 'https://www.pointswithacrew.com/feed/' },
  ],
  'InfoSec & AI': [
    { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml' },
    { name: 'Schneier on Security', url: 'https://www.schneier.com/feed/' },
    { name: 'SecurityWeek', url: 'https://feeds.feedburner.com/Securityweek' },
    { name: 'AI - The Guardian', url: 'https://www.guardian.co.uk/technology/artificialintelligenceai/rss' },
    { name: 'r/artificial', url: 'https://www.reddit.com/r/artificial/.rss' },
    { name: 'r/netsec', url: 'https://www.reddit.com/r/netsec/.rss' },
    { name: 'AWS Architecture', url: 'https://aws.amazon.com/blogs/architecture/feed/' },
    { name: 'MIT CSAIL', url: 'https://web.mit.edu/newsoffice/topic/mitcomputers-rss.xml' },
    { name: 'System Design', url: 'https://www.systemdesignbutsimple.com/feed' },
    { name: 'BeyondTrust', url: 'https://www.beyondtrust.com/feed/blog.xml' },
    { name: 'RSA Blog', url: 'https://www.rsa.com/blog/feed/' },
    { name: 'r/crypto', url: 'https://www.reddit.com/r/crypto/.rss' },
    { name: 'High Scalability', url: 'https://feeds.feedburner.com/HighScalability' },
    { name: 'CRN Cloud', url: 'https://www.crn.com/news/cloud/rss.xml' },
    { name: 'AWS Security', url: 'https://aws.amazon.com/blogs/security/feed/' },
    { name: 'r/programming', url: 'https://www.reddit.com/r/programming/.rss' },
    { name: 'Dark Reading IAM', url: 'https://www.darkreading.com/rss_simple.asp?f_n=657&f_ln=Identity%20and%20Access%20Management' },
  ],
  Federal: [
    { name: 'Nextgov', url: 'https://www.nextgov.com/rss/all/' },
    { name: 'FedScoop Acquisition', url: 'https://www.fedscoop.com/acquisition/feed/' },
    { name: 'FedScoop Defense', url: 'https://www.fedscoop.com/defense/feed/' },
    { name: 'Federal News Network', url: 'https://federalnewsnetwork.com/category/defense-main/defense-news/disa/?feed=rss' },
    { name: 'Breaking Defense', url: 'https://breakingdefense.com/category/networks-and-cyber/feed/' },
    { name: 'Air Force News', url: 'https://www.af.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=1&max=20' },
    { name: 'InsideDefense', url: 'https://insidedefense.com/rss.xml' },
    { name: 'Fifth Domain', url: 'https://feeds.feedburner.com/fifth-domain/home' },
    { name: 'DefenceIQ Cyber', url: 'https://www.defenceiq.com/rss/categories/cyber-defence-and-security' },
  ],
};

// Reddit section — built from reddit-feeds.json so the subreddit list is
// maintainable without touching code. Appears as its own news tab/section
// (and flows into the ticker) exactly like Tech, Aviation, etc.
FEED_CATEGORIES.Reddit = loadRedditFeeds();

// Cache for RSS feeds
const feedCache = {};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// API: Clear cache and refresh all data (news + weather + schedule)
app.post('/api/refresh', async (req, res) => {
  Object.keys(feedCache).forEach(k => delete feedCache[k]);

  // Re-read the subreddit list so edits to reddit-feeds.json take effect
  // on refresh without a server restart.
  FEED_CATEGORIES.Reddit = loadRedditFeeds();

  // Refresh weather, schedule, and world weather in parallel
  const results = await Promise.allSettled([
    refreshWeather().then(() => console.log('[Refresh] Weather data updated')),
    refreshSchedule().then(() => console.log('[Refresh] Schedule data updated')),
    refreshWorldWeather().then(() => console.log('[Refresh] World weather updated')),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const name = ['Weather', 'Schedule', 'World weather'][i] || 'Task';
      console.error(`[Refresh] ${name} refresh failed:`, r.reason?.message);
    }
  });

  res.json({ status: 'ok', message: 'All data refreshed' });
});

// API: Get news feeds by category
app.get('/api/news/:category', async (req, res) => {
  const category = req.params.category;
  const feeds = FEED_CATEGORIES[category];
  if (!feeds) {
    return res.status(404).json({ error: 'Category not found' });
  }

  // Per-category limits (Reddit = 10/feed, 48h; everything else 5/feed, 5d).
  const { perFeed, maxAgeMs } = limitsFor(category);

  const forceRefresh = req.query.refresh === '1';
  const cacheKey = category;
  if (!forceRefresh && feedCache[cacheKey] && Date.now() - feedCache[cacheKey].time < CACHE_DURATION) {
    // Re-filter the cached payload so stories don't survive past the
    // freshness window just because the cache hasn't expired yet.
    const cached = feedCache[cacheKey].data.filter(a => isFresh(a.pubDate, maxAgeMs));
    return res.json(cached);
  }

  let articles = [];
  let droppedStale = 0;

  if (category === 'Reddit') {
    // Reddit needs the multireddit-batched path (see fetchRedditCategory)
    // to avoid per-IP rate limiting that otherwise empties the category.
    const r = await fetchRedditCategory(feeds, maxAgeMs);
    articles = r.articles;
    droppedStale = r.dropped;

    const diskPath = path.join(__dirname, 'public', 'data', 'reddit-news.json');
    if (articles.length > 0) {
      // Persist the last good result so a future rate-limited refresh can
      // still show content instead of a blank section.
      try { fs.writeFileSync(diskPath, JSON.stringify(articles)); } catch (_) { /* ignore */ }
    } else {
      // Live fetch came back empty (almost always rate limiting). Fall back
      // to the last good batch on disk, filtered to the freshness window.
      try {
        if (fs.existsSync(diskPath)) {
          const saved = JSON.parse(fs.readFileSync(diskPath, 'utf8'));
          if (Array.isArray(saved)) {
            articles = saved.filter(a => isFresh(a.pubDate, maxAgeMs));
            console.log(`[news/Reddit] live fetch empty (rate limited) — served ${articles.length} from disk cache`);
          }
        }
      } catch (_) { /* ignore */ }
    }
  } else {
    const feedPromises = feeds.map(async (feed) => {
      try {
        const result = await fetchAndParseFeed(feed.url);
        // Resolve favicon once per feed (cheap, but no reason to do it per item).
        const favicon = resolveFavicon(feed.url, result);
        result.items.slice(0, perFeed).forEach(item => {
          const pubDate = item.pubDate || item.isoDate || '';
          // Skip anything older than the category's freshness window so it
          // never makes it into memory or the cache.
          if (!isFresh(pubDate, maxAgeMs)) {
            droppedStale++;
            return;
          }
          articles.push({
            source: feed.name,
            favicon,
            thumbnail: extractThumbnail(item),
            title: item.title || 'Untitled',
            link: item.link || '#',
            pubDate,
            snippet: (item.contentSnippet || item.content || '').substring(0, 200),
          });
        });
      } catch (e) {
        console.log(`Failed to fetch ${feed.name}: ${e.message}`);
      }
    });

    await Promise.all(feedPromises);
  }

  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  if (droppedStale > 0) {
    const hrs = Math.round(maxAgeMs / 3600000);
    console.log(`[news/${category}] dropped ${droppedStale} stale items (>${hrs}h old)`);
  }

  feedCache[cacheKey] = { time: Date.now(), data: articles };
  res.json(articles);
});

// API: Get all news categories
app.get('/api/news-categories', (req, res) => {
  res.json(Object.keys(FEED_CATEGORIES));
});

// API: Weather data (served from static JSON generated at build time)
app.get('/api/weather', (req, res) => {
  const weatherPath = path.join(__dirname, 'public', 'data', 'weather.json');
  if (fs.existsSync(weatherPath)) {
    res.json(JSON.parse(fs.readFileSync(weatherPath, 'utf8')));
  } else {
    res.status(404).json({ error: 'Weather data not yet generated' });
  }
});

// API: World weather (today's forecast for major world cities)
app.get('/api/world-weather', (req, res) => {
  const p = path.join(__dirname, 'public', 'data', 'world-weather.json');
  if (fs.existsSync(p)) {
    res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
  } else {
    res.status(404).json({ error: 'World weather data not yet generated' });
  }
});

// API: Sports schedule
app.get('/api/schedule', (req, res) => {
  const schedulePath = path.join(__dirname, 'public', 'data', 'schedule.json');
  if (fs.existsSync(schedulePath)) {
    res.json(JSON.parse(fs.readFileSync(schedulePath, 'utf8')));
  } else {
    res.status(404).json({ error: 'Schedule data not yet generated' });
  }
});

// API: Team Liquid SC2 events
app.get('/api/sc2events', (req, res) => {
  const sc2Path = path.join(__dirname, 'public', 'data', 'sc2events.json');
  if (fs.existsSync(sc2Path)) {
    res.json(JSON.parse(fs.readFileSync(sc2Path, 'utf8')));
  } else {
    res.status(404).json({ error: 'SC2 events not yet generated' });
  }
});

// API: Weather forecast by lat/lon (for browser location override)
app.get('/api/weather-by-coords', async (req, res) => {
  const { lat, lon, name } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

  try {
    const headers = { 'User-Agent': 'MarckNetVision Dashboard (ben@marck.net)', Accept: 'application/geo+json' };

    // Get gridpoint from NWS
    const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
    const pointData = await pointRes.json();
    const forecastUrl = pointData.properties?.forecast;
    if (!forecastUrl) throw new Error('No forecast URL found');

    // Get forecast
    const forecastRes = await fetch(forecastUrl, { headers });
    const forecastData = await forecastRes.json();
    const periods = forecastData.properties?.periods || [];

    // Parse into daily format (same as weather-scraper)
    const days = [];
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (!p.isDaytime) continue;
      const nightP = periods[i + 1] && !periods[i + 1].isDaytime ? periods[i + 1] : null;
      const dayName = p.name.replace(/ .*/, '');
      const shortDay = dayName.length > 3 ? dayName.substring(0, 3) : dayName;
      const displayDay = (p.name === 'This Afternoon' || p.name === 'Today') ? 'Today' : shortDay;
      const windMatch = (p.windSpeed || '').match(/(\d+)/);
      const windMph = windMatch ? parseInt(windMatch[1]) : 0;
      const cond = (p.shortForecast || '').toLowerCase();
      let cloudCover = 50;
      if (cond.includes('sunny') || cond.includes('clear')) cloudCover = 10;
      else if (cond.includes('mostly sunny')) cloudCover = 25;
      else if (cond.includes('partly')) cloudCover = 45;
      else if (cond.includes('mostly cloudy')) cloudCover = 70;
      else if (cond.includes('cloudy') || cond.includes('overcast')) cloudCover = 85;
      else if (cond.includes('rain') || cond.includes('snow')) cloudCover = 90;

      days.push({
        dayName: displayDay,
        date: new Date(p.startTime).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
        high: p.temperature,
        low: nightP ? nightP.temperature : p.temperature - 15,
        dewPoint: Math.round((nightP ? nightP.temperature : p.temperature - 15) - 5 + (p.probabilityOfPrecipitation?.value || 0) * 0.15),
        wind: `${windMph} mph ${p.windDirection || ''}`.trim(),
        cloudCover,
        precipChance: p.probabilityOfPrecipitation?.value || 0,
        condition: p.shortForecast || 'Unknown',
        forecastText: p.detailedForecast || p.shortForecast || '',
      });
      if (days.length >= 7) break;
    }

    // Fetch active alerts for the same point. Best-effort; alerts
    // failing won't block the forecast response.
    let alerts = [];
    try {
      alerts = await fetchNWSAlerts(parseFloat(lat), parseFloat(lon));
    } catch (e) {
      console.error('[WeatherByCoords] Alerts fetch failed:', e.message);
    }

    res.json({
      name: name || `${lat}, ${lon}`,
      sources: ['NWS'],
      lastUpdated: new Date().toISOString(),
      daily: days,
      alerts,
    });
  } catch (e) {
    console.error('[WeatherByCoords] Error:', e.message);
    res.status(500).json({ error: 'Failed to fetch weather for coordinates' });
  }
});

// API: Current weather observations from NWS by lat/lon
app.get('/api/current-weather', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'lat and lon required' });
  }

  try {
    const headers = { 'User-Agent': 'MarckNetVision Dashboard (ben@marck.net)', Accept: 'application/geo+json' };

    // Step 1: Get gridpoint metadata to find nearest station
    const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
    const pointData = await pointRes.json();
    const stationsUrl = pointData.properties?.observationStations;
    if (!stationsUrl) throw new Error('No observation stations found');

    // Step 2: Get nearest station
    const stationsRes = await fetch(stationsUrl, { headers });
    const stationsData = await stationsRes.json();
    const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
    if (!stationId) throw new Error('No station identifier found');

    // Step 3: Get latest observation
    const obsRes = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, { headers });
    const obsData = await obsRes.json();
    const props = obsData.properties || {};

    const tempC = props.temperature?.value;
    const tempF = tempC != null ? Math.round(tempC * 9 / 5 + 32) : null;
    const dewC = props.dewpoint?.value;
    const dewF = dewC != null ? Math.round(dewC * 9 / 5 + 32) : null;
    const windMph = props.windSpeed?.value != null ? Math.round(props.windSpeed.value * 0.621371) : null;
    const humidity = props.relativeHumidity?.value != null ? Math.round(props.relativeHumidity.value) : null;

    res.json({
      station: stationId,
      temperature: tempF,
      dewPoint: dewF,
      humidity: humidity,
      windSpeed: windMph,
      windDirection: props.windDirection?.value,
      description: props.textDescription || '',
      icon: props.icon || '',
      timestamp: props.timestamp,
    });
  } catch (e) {
    console.error('[CurrentWeather] Error:', e.message);
    res.status(500).json({ error: 'Failed to fetch current weather' });
  }
});

// API: Dow Jones stock index
app.get('/api/dow', async (req, res) => {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EDJI?interval=1d&range=1d';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'MarckNetVision Dashboard' }
    });
    const data = await response.json();
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) throw new Error('No data returned');

    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = price - prevClose;
    const changePct = (change / prevClose) * 100;

    res.json({
      price: Math.round(price * 100) / 100,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePct * 100) / 100,
      direction: change >= 0 ? 'up' : 'down',
    });
  } catch (e) {
    console.error('[Dow] Error:', e.message);
    res.status(500).json({ error: 'Failed to fetch Dow data' });
  }
});

// Serve pivotal weather GIF
app.get('/api/pivotal-gif', (req, res) => {
  const gifPath = path.join(__dirname, 'pivotal_weather_latest.gif');
  const fallbackPath = path.join(__dirname, 'pivotal_weather_2026-03-16.gif');
  const servePath = fs.existsSync(gifPath) ? gifPath : fallbackPath;
  if (fs.existsSync(servePath)) {
    res.sendFile(servePath);
  } else {
    res.status(404).send('GIF not found');
  }
});

app.listen(PORT, () => {
  console.log(`MarckNetVision Dashboard running at http://localhost:${PORT}`);
});
