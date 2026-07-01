const fetch = require('node-fetch');

// Cape Cod Baseball League games from capeleaguetv.com.
//
// capeleaguetv.com is a BlueFrame/Hudl "vCloud" portal (site slug "ccbltv").
// Its "Live / Upcoming" row — div id="swiper-content-Live / Upcoming" — is
// rendered client-side from the portal config:
//   //apps.blueframetech.com/api/v1/bft/ccbltv/config.json
// whose layout row { type:"broadcast", title:"Live / Upcoming",
// broadcastSearchParams:{ sortBy:"date", sortDir:"asc", viewerStatus:3 } }
// is fulfilled by the vCloud broadcast API across the league's team sites:
//   https://vcloud.hudl.com/api/viewer/broadcast?site_id=<ids>&viewer_status=3&...
//
// We hit that same API directly, filter to the schedule window, and map each
// broadcast into the standard schedule-item shape with the game type
// "Baseball (Summer)" so Cape League games display alongside the other
// baseball games. Each item's `link` is the broadcast's embeddable player URL
// so the dashboard can render the game inline in the main panel.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// vCloud site IDs for the Cape League portal (the league + each team), taken
// from the portal config's vCloud.siteIds. If the league adds/removes a team
// site this list can be refreshed from
// https://apps.blueframetech.com/api/v1/bft/ccbltv/config.json (vCloud.siteIds).
const CCBL_SITE_IDS = [12287, 12292, 11128, 12293, 12288, 12289, 12294, 12290, 12295, 12291, 12296];

const VCLOUD_BROADCAST_URL = 'https://vcloud.hudl.com/api/viewer/broadcast';

// Fetch the Cape League "Live / Upcoming" broadcasts and return the ones that
// fall inside the schedule window (same as the ESPN scraper: 5h ago → 20h
// ahead), shaped like the rest of the schedule items.
// Fetch one viewer_status worth of broadcasts (3 = live/upcoming,
// 4 = recent/archived), constrained to games from `after` onward.
async function fetchBroadcasts(viewerStatus, afterIso) {
  const params = new URLSearchParams({
    site_id: CCBL_SITE_IDS.join(','),
    viewer_status: String(viewerStatus),
    sort_by: 'date',
    sort_dir: 'asc',
    after: afterIso,
    per_page: '50',
    page: '1',
  });
  const res = await fetch(`${VCLOUD_BROADCAST_URL}?${params}`, {
    headers: { 'User-Agent': UA, Referer: 'https://www.capeleaguetv.com/' },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`vCloud ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.broadcasts) ? data.broadcasts : [];
}

// Parse a broadcast title into a clean matchup. Cape League titles are
// inconsistent — e.g. "AWAY @ HOME", "AWAY vs HOME", "AWAY vs. HOME",
// "AWAY at HOME", "[LIVE] AWAY at HOME | June 16, 2026 | Audio Only",
// "Y-D Red Sox @ Chatham Anglers RADIO BROADCAST",
// "Bourne Braves(1-1-1) @ Hyannis Harbor Hawk(1-2)".
// Returns { isGame, away, home, matchup }. Non-game content (Codcast /
// "Inside the Cape League" shows) returns isGame:false.
function parseGameTitle(raw) {
  let t = (raw || '').trim();
  if (/\bcodcast\b|\bepisode\b|inside the cape league/i.test(t)) {
    return { isGame: false };
  }
  t = t.replace(/^\s*\[[^\]]*\]\s*/g, '');          // strip leading [LIVE]/[...] tags
  t = t.split('|')[0].trim();                        // drop "| date | Audio Only" metadata
  t = t.replace(/\(audio only\)/ig, '');             // strip "(audio only)" before bare-word form
  t = t.replace(/\b(RADIO BROADCAST|audio only)\b/ig, '');
  t = t.replace(/\s*\([\d\s().-]*\d[\d\s().-]*\)/g, ''); // strip "(1-1-1)" records
  t = t.replace(/\(\s*\)/g, '');                      // remove any empty parens left behind
  t = t.replace(/\s{2,}/g, ' ').trim();

  // Split on the matchup separator: @, vs, vs., or " at ".
  const m = t.match(/^(.*?)\s+(?:@|vs\.?|at)\s+(.*)$/i);
  if (m && m[1].trim() && m[2].trim()) {
    const away = m[1].trim();
    const home = m[2].trim();
    return { isGame: true, away, home, matchup: `${away} vs ${home}` };
  }
  return { isGame: false };
}

// Upcoming Cape League games are shown up to this many hours ahead (live
// games are always shown regardless, see below).
const CAPE_FUTURE_HOURS = 20;

async function fetchCapeLeagueGames() {
  try {
    const now = new Date();
    const minPast = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const maxFuture = new Date(now.getTime() + CAPE_FUTURE_HOURS * 60 * 60 * 1000);

    // Fetch BOTH live/upcoming (status 3) and recently-finished (status 4).
    // The live/upcoming list uses a GENEROUS lookback (12h) so a game that
    // is still streaming long past its start — extra innings, rain delay —
    // is caught even though it started more than 5h ago; the platform keeps
    // a still-viewable game in viewer_status 3 until it actually ends. The
    // finished/archived list is bounded to the last 5h.
    const liveLookback = new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const [liveUpcoming, recent] = await Promise.all([
      fetchBroadcasts(3, liveLookback.toISOString()),
      fetchBroadcasts(4, minPast.toISOString()).catch(() => []),
    ]);

    // Dedupe by broadcast id, remembering whether it came from the
    // live/upcoming list (still active/viewable per the platform) vs the
    // archived list. The live/upcoming entry wins during the transition.
    const byId = new Map();
    for (const b of liveUpcoming) {
      if (b && b.id != null && !byId.has(b.id)) byId.set(b.id, { b, active: true });
    }
    for (const b of recent) {
      if (b && b.id != null && !byId.has(b.id)) byId.set(b.id, { b, active: false });
    }

    const items = [];
    for (const { b, active } of byId.values()) {
      const dateStr = b.date || '';
      if (!dateStr) continue;
      const eventDate = new Date(dateStr); // ISO with offset → absolute instant
      if (isNaN(eventDate.getTime())) continue;

      // A game is "live" when the platform still lists it as live/upcoming
      // (active) and its start time has passed.
      const isLive = active && eventDate <= now && (b.available !== false);

      if (active) {
        // Live or upcoming. Always keep live games (no past cutoff — that's
        // the whole point); cap upcoming at the +20h window.
        if (eventDate > maxFuture) continue;
      } else {
        // Finished/archived: only keep within the last 5h.
        if (eventDate < minPast || eventDate > maxFuture) continue;
      }

      const rawTitle = (b.title || '').trim();
      // Skip secondary audio-only / radio feeds — they duplicate the video
      // broadcast of the same game and aren't useful to render in-panel.
      if (/audio only|radio broadcast/i.test(rawTitle)) continue;
      // Parse + skip non-game content (podcasts/shows) that share the feed.
      const parsed = parseGameTitle(rawTitle);
      if (!parsed.isGame) continue;
      const awayName = parsed.away;
      const homeName = parsed.home;
      const matchup = parsed.matchup;

      const time = eventDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET';

      const network = 'Cape League TV';

      // Link the dashboard renders in the main panel: the embeddable player.
      const link = b.embed_code_src
        || (b.id ? `https://vcloud.hudl.com/broadcast/embed/${b.id}?autoplay=0` : '');

      items.push({
        sport: 'Baseball (Summer)',
        matchup,
        homeName,
        awayName,
        homeLogo: '',
        awayLogo: '',
        leagueLogo: '',
        network,
        time,
        link,
        linkType: 'embed',          // tells the client to render inline (iframe)
        live: isLive,               // still active/viewable → bypass the 5h cutoff
        sortTime: eventDate.toISOString(),
        status: isLive ? 'Live' : (b.status || 'Upcoming'),
      });
    }

    const liveCount = items.filter(i => i.live).length;
    console.log(`[CapeLeague] ${byId.size} broadcasts fetched, ${items.length} within window (${liveCount} live)`);
    return items;
  } catch (e) {
    console.error(`[CapeLeague] fetch failed: ${e.message}`);
    return [];
  }
}

module.exports = { fetchCapeLeagueGames };

// Run directly for testing: `node capeleague-scraper.js`
if (require.main === module) {
  fetchCapeLeagueGames().then(items => {
    console.log(`\n${items.length} Cape League games in window:`);
    items.forEach(i => console.log(`  ${i.time.padEnd(10)} ${i.matchup}  [${i.network}]  ${i.link}`));
  });
}
