const express = require('express');
const RSSParser = require('rss-parser');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');

const { refreshWeather } = require('./weather-scraper');
const { refreshSchedule } = require('./schedule-scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new RSSParser();

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

// Cache for RSS feeds
const feedCache = {};
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

// API: Clear cache and refresh all data (news + weather + schedule)
app.post('/api/refresh', async (req, res) => {
  Object.keys(feedCache).forEach(k => delete feedCache[k]);

  // Refresh weather and schedule in parallel
  const results = await Promise.allSettled([
    refreshWeather().then(() => console.log('[Refresh] Weather data updated')),
    refreshSchedule().then(() => console.log('[Refresh] Schedule data updated')),
  ]);

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const name = i === 0 ? 'Weather' : 'Schedule';
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

  const forceRefresh = req.query.refresh === '1';
  const cacheKey = category;
  if (!forceRefresh && feedCache[cacheKey] && Date.now() - feedCache[cacheKey].time < CACHE_DURATION) {
    return res.json(feedCache[cacheKey].data);
  }

  const articles = [];
  const feedPromises = feeds.map(async (feed) => {
    try {
      const result = await parser.parseURL(feed.url);
      result.items.slice(0, 5).forEach(item => {
        articles.push({
          source: feed.name,
          title: item.title || 'Untitled',
          link: item.link || '#',
          pubDate: item.pubDate || item.isoDate || '',
          snippet: (item.contentSnippet || item.content || '').substring(0, 200),
        });
      });
    } catch (e) {
      console.log(`Failed to fetch ${feed.name}: ${e.message}`);
    }
  });

  await Promise.all(feedPromises);
  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

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

    res.json({
      name: name || `${lat}, ${lon}`,
      sources: ['NWS'],
      lastUpdated: new Date().toISOString(),
      daily: days,
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
