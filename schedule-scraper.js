const fetch = require('node-fetch');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

// ESPN Guide Feed API
const ESPN_GUIDE_URL = 'https://site.web.api.espn.com/apis/personalized/site/v2/guide/feed';
const ESPN_PARAMS = 'region=us&lang=en&configuration=STREAM_MENU&platform=web&buyWindow=1m&showAirings=buy%2Clive&ontology=true&limit=50&entitlements=ESPN_PLUS&postalCode=45237&swid=%7B8DEA0A28-3A4D-4EB5-B199-73095176C226%7D&hydrated=favorites&features=sfb-all%2Ccutl&tz=America%2FNew_York&playabilitySource=playbackId';
const ESPN_HEADERS = {
  'accept': '*/*',
  'origin': 'https://www.espn.com',
  'referer': 'https://www.espn.com/',
  'user-agent': UA,
};

// Allowed sports and their league mappings
const ALLOWED_SPORTS = {
  'baseball': { leagueMap: { 'MLB': 'MLB', 'CBASE': 'College' } },
  'football': { leagueMap: { 'NFL': 'NFL', 'CFB': 'CFB', 'UFL': 'UFL' } },
  'basketball': { leagueMap: { 'NBA': 'NBA', 'NCAAM': 'NCAAM' } },
  'tennis': { leagueMap: {} },  // accept all tennis
  'golf': { leagueMap: { 'PGA': 'PGA' } },
};

// Fetch all pages from ESPN Guide Feed
async function fetchESPNGuideFeed() {
  const allEvents = [];
  const maxPages = 4;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = `${ESPN_GUIDE_URL}?${ESPN_PARAMS}&page=${page}`;
      const res = await fetch(url, { headers: ESPN_HEADERS, timeout: 15000 });
      if (!res.ok) {
        console.error(`[Schedule] ESPN Guide page ${page}: HTTP ${res.status}`);
        break;
      }
      const data = await res.json();
      const events = data.events || [];
      allEvents.push(...events);
      if (events.length < 50) break; // last page
    } catch (e) {
      console.error(`[Schedule] ESPN Guide page ${page} failed: ${e.message}`);
      break;
    }
  }

  console.log(`[Schedule] ESPN Guide Feed: ${allEvents.length} raw events across pages`);
  return parseESPNGuideEvents(allEvents);
}

// Pull the broadcast / streaming channel out of an ESPN Guide event.
//
// Confirmed JSON shape (Guide Feed v2 with STREAM_MENU configuration):
//   event.watch.broadcasts[] — array of { priority, type.slug, market.type,
//                                         media.shortName, station, ... }
//     type.slug    = "television" | "streaming" | "radio"
//     market.type  = "National" | "Home" | "Away" | "Not Applicable"
//     priority     = 1-N, lower is better
//   event.watch.tags[]       — convenience flat array of station names
//
// We prefer National TV, then any TV, then National streaming, then
// other streaming — capped at 2 names so the ticker stays readable.
// Returns '' if no broadcaster info is in the JSON (caller renders 'TBD').
function extractNetwork(event) {
  const broadcasts = event?.watch?.broadcasts;
  const tags       = event?.watch?.tags;

  // Helper: rank a broadcast entry. Lower = better.
  const score = (b) => {
    const t  = (b?.type?.slug || '').toLowerCase();      // television / streaming / radio
    const m  = (b?.market?.type || '').toLowerCase();    // national / home / away / not applicable
    let base;
    if (t === 'television' && m === 'national')      base = 0;
    else if (t === 'television')                     base = 1;
    else if (t === 'streaming' && m === 'national')  base = 2;
    else if (t === 'streaming')                      base = 3;
    else if (t === 'radio')                          base = 5;
    else                                             base = 4;
    // Within the same bucket, respect ESPN's own priority field (1 best).
    return base * 100 + (Number.isFinite(b?.priority) ? b.priority : 99);
  };

  const nameOf = (b) =>
    (b?.media?.shortName || b?.media?.name || b?.station || b?.media?.callLetters || '').trim();

  const uniq = (arr) => {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
      const key = v.toLowerCase();
      if (v && !seen.has(key)) { seen.add(key); out.push(v); }
    }
    return out;
  };

  // 1) Preferred path — sort the broadcasts array, take top 2 by rank.
  if (Array.isArray(broadcasts) && broadcasts.length) {
    const ranked = broadcasts
      .slice()
      .sort((a, b) => score(a) - score(b))
      .map(nameOf)
      .filter(Boolean);
    const list = uniq(ranked).slice(0, 2);
    if (list.length) return list.join(' / ');
  }

  // 2) Fallback — ESPN provides a flat `tags` array of station names. Take
  //    the first 2; this trips when broadcasts[] is missing but tags isn't.
  if (Array.isArray(tags) && tags.length) {
    const list = uniq(tags.map(t => String(t || '').trim()).filter(Boolean)).slice(0, 2);
    if (list.length) return list.join(' / ');
  }

  return '';
}

// Build the best user-facing watch / gamecast URL for an ESPN Guide event.
//
// The Guide Feed doesn't expose a clean spectator URL — `event.watch.style.link`
// is an internal API picker endpoint that won't render in a popup. What it
// DOES expose is `event.id` and `event.league.slug`, which combine into
// the standard ESPN gamecast URL pattern:
//
//   https://www.espn.com/{league.slug}/game/_/gameId/{event.id}
//
// That URL renders the live game tracker with play-by-play, score, and
// (for ESPN+ games) a "Watch" button. Returns '' if either piece is missing.
function extractGameLink(event) {
  const id = event?.id;
  const leagueSlug = event?.league?.slug;
  if (!id || !leagueSlug) return '';
  return `https://www.espn.com/${leagueSlug}/game/_/gameId/${id}`;
}

// Parse ESPN Guide events into schedule items
function parseESPNGuideEvents(events) {
  const items = [];
  const now = new Date();
  const maxFuture = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  // Keep events visible until 5 hours past their start time.
  const minPast = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const event of events) {
    const sportSlug = event.sport?.slug || '';
    const sportName = event.sport?.displayName || '';
    const leagueAbbr = event.league?.abbreviation || event.league?.shortName || '';

    // Check if sport is in our allowed list
    const sportConfig = ALLOWED_SPORTS[sportSlug];
    if (!sportConfig) continue;

    // If sport has specific leagues defined, filter to those
    const leagueKeys = Object.keys(sportConfig.leagueMap);
    let leagueLabel = '';
    if (leagueKeys.length > 0) {
      if (!sportConfig.leagueMap[leagueAbbr]) continue;
      leagueLabel = sportConfig.leagueMap[leagueAbbr];
    }

    // Filter out women's events
    const eventName = event.name || event.shortName || '';
    const leagueName = event.league?.name || event.league?.displayName || '';
    if (/women|woman|wbb|wnba|wnt|lpga|ncaaw|ladies/i.test(eventName + ' ' + leagueName + ' ' + leagueAbbr)) {
      continue;
    }
    // Also check league IDs for women's softball
    if (/CSOFT|WSOFT/i.test(leagueAbbr)) continue;

    // Date filtering
    const dateStr = event.date || '';
    if (!dateStr) continue;
    const eventDate = new Date(dateStr);

    if (eventDate < minPast || eventDate > maxFuture) continue;

    // Skip midnight placeholder events
    const etHour = parseInt(eventDate.toLocaleTimeString('en-US', {
      hour: 'numeric', hour12: false, timeZone: 'America/New_York',
    }));
    const etMinute = eventDate.getMinutes();
    if (etHour === 0 && etMinute === 0 && eventDate > new Date(todayStart.getTime() + 1 * 24 * 60 * 60 * 1000)) {
      continue;
    }

    // Build time string
    const time = eventDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    }) + ' ET';

    // Build matchup
    let matchup = '';
    if (sportSlug === 'golf') {
      matchup = eventName || 'PGA Tour Event';
      const status = event.status?.type?.description || '';
      if (status) matchup += ` (${status})`;
    } else if (event.competitors?.length >= 2) {
      const away = event.competitors.find(c => c.homeAway === 'away');
      const home = event.competitors.find(c => c.homeAway === 'home');
      const awayName = away?.team?.shortDisplayName || away?.team?.displayName || away?.displayName || 'TBD';
      const homeName = home?.team?.shortDisplayName || home?.team?.displayName || home?.displayName || 'TBD';
      matchup = `${awayName} vs ${homeName}`;
    } else if (event.shortName) {
      // shortName is typically "AWAY @ HOME"
      matchup = event.shortName.replace(' @ ', ' vs ');
    } else {
      matchup = eventName;
    }

    // Get network/broadcast info from the JSON feed (airings/broadcasts).
    // Falls back to 'TBD' rather than 'ESPN+' so we don't lie about where
    // the game is actually airing.
    const network = extractNetwork(event) || 'TBD';

    // Determine sport label
    const sportLabel = leagueLabel
      ? `${sportName} (${leagueLabel})`
      : sportName;

    items.push({
      sport: sportLabel,
      matchup,
      network,
      time,
      link: extractGameLink(event),
      sortTime: dateStr,
    });
  }

  return items;
}

// Fetch Team Liquid SC2 calendar
async function fetchTeamLiquidSC2() {
  try {
    const res = await fetch('https://tl.net/calendar/xml/calendar.xml', {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`TL ${res.status}`);
    const xml = await res.text();

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(xml);

    const events = [];
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 20 * 60 * 60 * 1000);

    // Get current month/year
    const months = result.calendar?.month;
    const monthArr = Array.isArray(months) ? months : [months];

    for (const month of monthArr) {
      if (!month) continue;
      const monthNum = parseInt(month.$.num);
      const yearNum = parseInt(month.$.year);

      const days = month.day;
      const dayArr = Array.isArray(days) ? days : [days];

      for (const day of dayArr) {
        if (!day) continue;
        const dayNum = parseInt(day.$.num);

        const dayEvents = day.event;
        if (!dayEvents) continue;
        const eventArr = Array.isArray(dayEvents) ? dayEvents : [dayEvents];

        for (const ev of eventArr) {
          // Only SC2 events
          const type = (typeof ev.type === 'string' ? ev.type : ev.type?._ || '').trim();
          if (!/starcraft\s*2/i.test(type)) continue;

          // TL calendar hours are +12 from Eastern
          const hour = parseInt(ev.$.hour || '0');
          const minute = parseInt(ev.$.minute || '0');

          // Convert: subtract 12 hours for Eastern Time
          let etHour = hour - 12;
          let etDay = dayNum;
          let etMonth = monthNum;
          if (etHour < 0) {
            etHour += 24;
            etDay -= 1;
            if (etDay < 1) {
              etMonth -= 1;
              etDay = 28; // approximate
            }
          }

          // Build date for comparison
          const eventDate = new Date(yearNum, etMonth - 1, etDay, etHour, minute);

          // Check if within next 24 hours
          // Keep SC2 events visible until 5 hours past their start time.
          if (eventDate >= new Date(now.getTime() - 5 * 60 * 60 * 1000) && eventDate <= tomorrow) {
            const isOver = ev.$.over === '1';
            const title = (typeof ev.title === 'string' ? ev.title : ev.title?._ || '').trim();
            const desc = (typeof ev.description === 'string' ? ev.description : ev.description?._ || '').trim();
            const link = (typeof ev['liquipedia-url'] === 'string' ? ev['liquipedia-url'] : ev['liquipedia-url']?._ || '').trim();

            const timeStr = eventDate.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York',
            }) + ' ET';

            events.push({
              sport: 'SC2',
              matchup: desc ? `${title}: ${desc}` : title,
              network: 'Online',
              time: timeStr,
              link: link || '',
              sortTime: eventDate.toISOString(),
              status: isOver ? 'Completed' : 'Upcoming',
            });
          }
        }
      }
    }

    return events;
  } catch (e) {
    console.error(`[Schedule] Team Liquid fetch failed: ${e.message}`);
    return [];
  }
}

// Apply filtering rules
function filterAndSort(allItems) {
  // MLB Baseball (up to 40)
  const mlbBaseball = allItems.filter(i => i.sport === 'Baseball (MLB)').slice(0, 40);
  // College Baseball: sample from different start times across the window
  const collegeBaseballAll = allItems.filter(i => i.sport === 'Baseball (College)');
  collegeBaseballAll.sort((a, b) => (a.sortTime || '').localeCompare(b.sortTime || ''));
  const collegeBaseball = [];
  const cbSeenHours = new Map(); // hour -> count
  for (const game of collegeBaseballAll) {
    const hourMatch = (game.time || '').match(/^(\d+):/);
    const ampm = (game.time || '').match(/(AM|PM)/i);
    const hourKey = hourMatch && ampm ? `${hourMatch[1]}${ampm[1]}` : game.time;
    const countAtHour = cbSeenHours.get(hourKey) || 0;
    // Allow up to 3 games per start time, prefer variety
    if (countAtHour < 3 || collegeBaseball.length < 6) {
      collegeBaseball.push(game);
      cbSeenHours.set(hourKey, countAtHour + 1);
    }
    if (collegeBaseball.length >= 25) break;
  }
  // Combined baseball, MLB first
  const baseball = [...mlbBaseball, ...collegeBaseball].slice(0, 40);

  // Football (up to 40)
  const football = allItems.filter(i => i.sport.startsWith('Football')).slice(0, 40);

  // Basketball: varied start times, max 10
  const basketballAll = allItems.filter(i => i.sport.startsWith('Basketball'));
  const basketball = [];
  const seenTimes = new Set();
  basketballAll.sort((a, b) => (a.sortTime || '').localeCompare(b.sortTime || ''));
  for (const game of basketballAll) {
    const timeBucket = game.time?.replace(/:\d{2}\s/, ':00 ') || '';
    if (basketball.length < 10) {
      if (seenTimes.size < 3 || !seenTimes.has(timeBucket) || basketball.length < 6) {
        basketball.push(game);
        seenTimes.add(timeBucket);
      }
    }
  }

  const tennis = allItems.filter(i => i.sport === 'Tennis').slice(0, 5);
  const golf = allItems.filter(i => i.sport === 'Golf').slice(0, 3);
  const sc2 = allItems.filter(i => i.sport === 'SC2');

  // Intersperse SC2 events between every sport group
  const sportGroups = [baseball, football, basketball, tennis, golf].filter(g => g.length > 0);
  const result = [];

  for (let i = 0; i < sportGroups.length; i++) {
    result.push(...sportGroups[i]);
    // Insert SC2 events between sport groups (distribute evenly)
    if (sc2.length > 0) {
      const sc2PerGap = Math.ceil(sc2.length / sportGroups.length);
      const start = i * sc2PerGap;
      const end = Math.min(start + sc2PerGap, sc2.length);
      result.push(...sc2.slice(start, end));
    }
  }
  // If no sport groups but SC2 exists, just add them
  if (sportGroups.length === 0 && sc2.length > 0) {
    result.push(...sc2);
  }

  console.log(`[Schedule] Breakdown: MLB=${mlbBaseball.length}, College BB=${collegeBaseball.length}, Football=${football.length}, Basketball=${basketball.length}, Tennis=${tennis.length}, Golf=${golf.length}, SC2=${sc2.length}`);

  return result;
}

// Merge newly-scraped events with whatever's still fresh from the prior
// schedule.json. ESPN's Guide Feed drops events from its response once
// they end (often within 2-4h of start), but we promise to display them
// for 5 hours past their start time. Without this merge, an event that
// rolls off ESPN's feed at the 3h mark would also vanish from our UI at
// the next scrape, breaking that promise. We keep any prior item whose
// sortTime is within the 5h window and isn't already in the new scrape.
function mergeWithPreviousSchedule(newItems, schedulePath) {
  const FIVE_HOURS = 5 * 60 * 60 * 1000;
  const cutoff = Date.now() - FIVE_HOURS;
  let prior = [];
  try {
    if (fs.existsSync(schedulePath)) {
      prior = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[Schedule] Could not read prior schedule: ${e.message}`);
    return newItems;
  }
  if (!Array.isArray(prior) || prior.length === 0) return newItems;

  // Key an event by sport+matchup+sortTime — strong enough to dedupe
  // ESPN games that survive between scrapes and SC2 entries by title.
  const keyOf = (it) => `${it.sport}|${it.matchup}|${it.sortTime || it.time || ''}`;
  const haveKeys = new Set(newItems.map(keyOf));

  let retained = 0;
  const carryOvers = [];
  for (const item of prior) {
    if (haveKeys.has(keyOf(item))) continue;
    const t = item.sortTime ? new Date(item.sortTime).getTime() : NaN;
    // No usable timestamp → skip (we can't prove it's still fresh).
    if (!Number.isFinite(t)) continue;
    if (t < cutoff) continue;
    carryOvers.push(item);
    retained++;
  }
  if (retained > 0) {
    console.log(`[Schedule] Carried over ${retained} in-progress events from prior schedule (still within 5h window)`);
  }
  return [...newItems, ...carryOvers];
}

// Main: refresh schedule
async function refreshSchedule() {
  console.log('[Schedule] Refreshing sports schedule...');

  // Fetch ESPN Guide Feed + TL in parallel
  const [espnItems, sc2Items] = await Promise.all([
    fetchESPNGuideFeed(),
    fetchTeamLiquidSC2(),
  ]);

  const allItems = [...espnItems, ...sc2Items];
  console.log(`[Schedule] Raw items: ${allItems.length}`);

  const filtered = filterAndSort(allItems);
  console.log(`[Schedule] Filtered items: ${filtered.length}`);

  // Merge with the previous schedule so events ESPN has already dropped
  // (because they finished) still display until they're 5h past start.
  const schedulePath = path.join(__dirname, 'public', 'data', 'schedule.json');
  const merged = mergeWithPreviousSchedule(filtered, schedulePath);
  console.log(`[Schedule] After merge with prior schedule: ${merged.length}`);

  // Save schedule
  fs.writeFileSync(schedulePath, JSON.stringify(merged, null, 2));
  console.log(`[Schedule] Saved to ${schedulePath}`);

  // Save SC2 events separately
  const sc2Events = sc2Items.map(i => ({
    name: i.matchup,
    time: i.time,
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    link: i.link || '',
    status: i.status || 'Upcoming',
  }));
  const sc2Path = path.join(__dirname, 'public', 'data', 'sc2events.json');
  fs.writeFileSync(sc2Path, JSON.stringify(sc2Events, null, 2));
  console.log(`[Schedule] SC2 events: ${sc2Events.length}`);

  return filtered;
}

module.exports = { refreshSchedule };

// Run directly for testing
if (require.main === module) {
  refreshSchedule().then(data => {
    console.log('\n=== Final Schedule ===');
    data.forEach(item => {
      console.log(`  [${item.sport}] ${item.matchup} | ${item.network} | ${item.time}`);
    });
  });
}
