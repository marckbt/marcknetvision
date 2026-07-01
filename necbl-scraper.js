const fetch = require('node-fetch');

// New England Collegiate Baseball League (NECBL) games from ESPN Watch.
//
// Source: the ESPN Watch "Baseball" catalog page
//   https://www.espn.com/watch/catalog/e364bfcd-493d-3bfb-ac83-bd27d66fedd0/baseball#bucketId=29451&sourceCollection=categories
// That SPA is backed by ESPN's Watch product API. Inside the Baseball
// catalog's "Explore More in Baseball" bucket is the NECBL league category
// (id 747e375f-8b74-3b44-81c6-ce5b3583999c — "The New England Collegiate
// Baseball League"). Fetching that category's catalog returns a
// "Live & Upcoming" bucket of game "listing" events with start times and
// playback links.
//
// We map those into the standard schedule-item shape with the game type
// "Baseball (Summer)" so NECBL games show alongside the other baseball
// games. These are ESPN+ events (auth-gated, not iframe-embeddable), so the
// link is the ESPN Watch player page — opened in a popup like other ESPN
// games, not rendered inline.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// NECBL league category id (from the Baseball catalog's "Explore More" bucket).
const NECBL_CATEGORY_ID = '747e375f-8b74-3b44-81c6-ce5b3583999c';
const CATALOG_URL = `https://watch.product.api.espn.com/api/product/v3/watchespn/web/catalog/${NECBL_CATEGORY_ID}`;

// Upcoming NECBL games are shown up to this many hours ahead (live games
// are always shown regardless).
const NECBL_FUTURE_HOURS = 20;

// Split an ESPN listing name ("Vermont Mountaineers vs. Sanford Mainers")
// into away/home + a normalised "AWAY vs HOME" matchup.
function parseMatchup(name) {
  const raw = (name || '').trim();
  const m = raw.match(/^(.*?)\s+vs\.?\s+(.*)$/i) || raw.match(/^(.*?)\s+@\s+(.*)$/);
  if (m && m[1].trim() && m[2].trim()) {
    const away = m[1].trim();
    const home = m[2].trim();
    return { away, home, matchup: `${away} vs ${home}` };
  }
  return { away: '', home: '', matchup: raw };
}

async function fetchNECBLGames() {
  try {
    const now = new Date();
    const minPast = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const maxFuture = new Date(now.getTime() + NECBL_FUTURE_HOURS * 60 * 60 * 1000);

    const url = `${CATALOG_URL}?lang=en&features=imageProperties&countryCode=US&tz=America/New_York`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.espn.com/' },
      timeout: 15000,
    });
    if (!res.ok) throw new Error(`ESPN Watch ${res.status}`);
    const data = await res.json();

    const buckets = data.page && Array.isArray(data.page.buckets) ? data.page.buckets : [];
    const liveUpcoming = buckets.find(b => /live|upcoming/i.test(b.name || ''));
    const contents = liveUpcoming && Array.isArray(liveUpcoming.contents) ? liveUpcoming.contents : [];

    const items = [];
    for (const c of contents) {
      if (c.type !== 'listing') continue;          // skip non-game tiles
      const iso = c.utc || '';
      if (!iso) continue;
      const eventDate = new Date(iso);             // ISO with offset → absolute instant
      if (isNaN(eventDate.getTime())) continue;

      const status = (c.status || '').toLowerCase();
      const isLive = status === 'live';

      // Keep live games always; upcoming within the future window; and
      // (defensively) anything within the last 5h.
      if (!isLive) {
        if (eventDate < minPast || eventDate > maxFuture) continue;
      }

      const { away, home, matchup } = parseMatchup(c.name);

      const time = eventDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET';

      // ESPN+ watch page for the event (auth-gated; opens in a popup).
      const link = `https://www.espn.com/watch/player/_/id/${c.id}`;

      items.push({
        sport: 'Baseball (Summer)',
        matchup,
        homeName: home,
        awayName: away,
        homeLogo: '',
        awayLogo: '',
        leagueLogo: '',
        network: 'ESPN+',
        time,
        link,
        live: isLive,             // still active/viewable → bypass the 5h cutoff
        sortTime: eventDate.toISOString(),
        status: isLive ? 'Live' : (c.status || 'Upcoming'),
      });
    }

    const liveCount = items.filter(i => i.live).length;
    console.log(`[NECBL] ${contents.length} listings, ${items.length} within window (${liveCount} live)`);
    return items;
  } catch (e) {
    console.error(`[NECBL] fetch failed: ${e.message}`);
    return [];
  }
}

module.exports = { fetchNECBLGames };

// Run directly for testing: `node necbl-scraper.js`
if (require.main === module) {
  fetchNECBLGames().then(items => {
    console.log(`\n${items.length} NECBL games in window:`);
    items.forEach(i => console.log(`  ${i.time.padEnd(10)} ${(i.live ? '[LIVE] ' : '')}${i.matchup}  ${i.link}`));
  });
}
