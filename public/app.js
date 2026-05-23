// ===== MarckNetVision Dashboard App =====

// --- Weather Channel Temperature Color Scale ---
function getTempColor(temp) {
  // Color stops based on the Weather Channel temperature scale
  const stops = [
    { t: -20, r: 207, g: 179, b: 212 }, // pale lavender
    { t: -10, r: 153, g: 102, b: 170 }, // purple
    { t:   0, r: 204, g:  51, b: 153 }, // magenta
    { t:  10, r: 204, g: 153, b: 221 }, // light purple
    { t:  20, r: 153, g: 204, b: 255 }, // light blue
    { t:  30, r:   0, g: 204, b: 221 }, // cyan
    { t:  40, r:   0, g: 102,  b:  51 }, // dark green
    { t:  50, r: 136, g: 136, b:  51 }, // olive
    { t:  60, r: 255, g: 238, b:   0 }, // yellow
    { t:  70, r: 255, g: 170, b:  51 }, // gold
    { t:  80, r: 255, g: 119, b:  34 }, // orange
    { t:  90, r: 221, g:  34, b:  17 }, // red
    { t: 100, r: 238, g: 102, b: 170 }, // pink
    { t: 110, r: 221, g: 187, b: 221 }, // lavender
  ];
  // Clamp to range
  if (temp <= stops[0].t) return `rgb(${stops[0].r},${stops[0].g},${stops[0].b})`;
  if (temp >= stops[stops.length - 1].t) { const s = stops[stops.length - 1]; return `rgb(${s.r},${s.g},${s.b})`; }
  // Find surrounding stops and interpolate
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (temp >= a.t && temp <= b.t) {
      const f = (temp - a.t) / (b.t - a.t);
      const r = Math.round(a.r + f * (b.r - a.r));
      const g = Math.round(a.g + f * (b.g - a.g));
      const bl = Math.round(a.b + f * (b.b - a.b));
      return `rgb(${r},${g},${bl})`;
    }
  }
  return '#ffffff';
}

// --- Theme ---
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

function setTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem('mnv-theme', theme);
  themeToggle.querySelector('.theme-icon').textContent = theme === 'dark' ? '\u263E' : '\u2600';
}

themeToggle.addEventListener('click', () => {
  const current = html.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Init theme
setTheme(localStorage.getItem('mnv-theme') || 'dark');

// --- Mobile Hamburger Menu ---
// The hamburger is only visible on small viewports (CSS-controlled).
// Toggling body.menu-open shows/hides the #topControls drawer.
(function initMobileMenu() {
  const toggle = document.getElementById('mobileMenuToggle');
  const controls = document.getElementById('topControls');
  if (!toggle || !controls) return;

  function setOpen(open) {
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!document.body.classList.contains('menu-open'));
  });

  // Tap outside the drawer closes it. We don't close on taps inside
  // #topControls itself so users can interact with the buttons.
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('menu-open')) return;
    if (controls.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
  });

  // Close the menu after the user activates any control inside it,
  // so they're not left staring at a drawer covering the content.
  // Exceptions: tapping the location chip (opens its inline dropdown),
  // typing in the search input, and clicking the reset button — those
  // keep the drawer open so the city list stays visible.
  controls.addEventListener('click', (e) => {
    const target = e.target;
    // Tapping a city result should close everything.
    if (target.closest('.location-result-item')) {
      setTimeout(() => setOpen(false), 0);
      return;
    }
    // Anything inside the location dropdown UI (search input, etc.)
    // should leave the drawer open.
    if (target.closest('.location-wrapper')) return;
    const btn = target.closest('button');
    if (!btn) return;
    setTimeout(() => setOpen(false), 0);
  });

  // If the viewport grows past the mobile breakpoint while the drawer
  // is open, drop the open state so the controls render inline.
  const mq = window.matchMedia('(max-width: 900px)');
  mq.addEventListener?.('change', (ev) => {
    if (!ev.matches) setOpen(false);
  });
})();

// --- Mobile Ticker Relocation ---
// On mobile, the LIVE VIDEO section is replaced by the bottom ticker.
// We physically move #tickerBar into the .sidebar-bottom slot (in front
// of the original live-video header/area, which gets hidden via CSS),
// and let the original ticker position at the bottom of the viewport
// collapse. On desktop we move it back. The ticker's animation-duration
// recalculation is rerun after relocation so the scroll speed adapts
// to the new container width.
(function initMobileTickerRelocation() {
  const tickerBar = document.getElementById('tickerBar');
  const sidebarBottom = document.querySelector('#weatherSidebar .sidebar-bottom');
  if (!tickerBar || !sidebarBottom) return;
  const originalParent = tickerBar.parentNode;
  const originalNext = tickerBar.nextSibling;
  const mq = window.matchMedia('(max-width: 900px)');

  function recalcTickerSpeed() {
    const track = document.getElementById('tickerTrack');
    if (!track) return;
    requestAnimationFrame(() => {
      const totalWidth = track.scrollWidth / 2;
      if (!totalWidth) return;
      const duration = Math.max(60, totalWidth / 80);
      track.style.animationDuration = duration + 's';
    });
  }

  function apply(matches) {
    if (matches) {
      if (tickerBar.parentNode !== sidebarBottom) {
        sidebarBottom.appendChild(tickerBar);
        document.body.classList.add('ticker-relocated');
      }
    } else {
      if (tickerBar.parentNode !== originalParent) {
        originalParent.insertBefore(tickerBar, originalNext);
        document.body.classList.remove('ticker-relocated');
      }
    }
    recalcTickerSpeed();
  }

  apply(mq.matches);
  mq.addEventListener?.('change', (ev) => apply(ev.matches));
})();

// --- Date ---
document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
});

// --- Panel Navigation ---
function showPanel(panelId) {
  document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');
}

// --- Swap State ---
let isSwapped = false;
let cachedScheduleData = [];
let allNewsCategoriesList = [];

// --- News ---
let allNewsData = {};

async function loadNewsCategory(category, forceRefresh = false) {
  const scrollArea = document.getElementById('newsScrollArea');

  if (!forceRefresh && allNewsData[category]) {
    if (!isSwapped) renderNewsCards(allNewsData[category]);
    return;
  }

  if (!isSwapped) {
    scrollArea.innerHTML = '<div class="loading-spinner">Loading ' + category + '...</div>';
  }

  try {
    const qs = forceRefresh ? '?refresh=1' : '';
    const res = await fetch('/api/news/' + encodeURIComponent(category) + qs);
    const articles = await res.json();
    allNewsData[category] = articles;
    if (!isSwapped) {
      renderNewsCards(articles);
    }
  } catch (e) {
    if (!isSwapped) {
      scrollArea.innerHTML = '<div class="loading-spinner">Failed to load feeds</div>';
    }
  }

  // If swapped and this was a force refresh, update the news ticker
  if (isSwapped && forceRefresh) {
    const allArticles = await getAllNewsForTicker();
    renderNewsTicker(allArticles);
  }
}

function renderNewsCards(articles) {
  const scrollArea = document.getElementById('newsScrollArea');
  if (!articles.length) {
    scrollArea.innerHTML = '<div class="loading-spinner">No articles found</div>';
    return;
  }

  // Sort by publication date, newest first
  const sorted = [...articles].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  scrollArea.innerHTML = sorted.map((a, i) => {
    const timeAgo = getTimeAgo(a.pubDate);
    // Thumbnail is only rendered in the left-panel card. Ticker items
    // and the article popup intentionally skip it. If the thumbnail
    // 404s or fails to load, onerror collapses the whole figure so the
    // card doesn't render an empty gap.
    const thumb = a.thumbnail
      ? `<figure class="news-thumb"><img src="${escapeHtml(a.thumbnail)}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></figure>`
      : '';
    return `<div class="news-card ${a.thumbnail ? 'has-thumb' : ''}" data-index="${i}" onclick="showNewsDetail(${JSON.stringify(a).replace(/"/g, '&quot;')})">
      ${thumb}
      <div class="news-card-body">
        <div class="source">${renderFavicon(a.favicon)}${escapeHtml(a.source)}</div>
        <div class="title">${escapeHtml(a.title)}</div>
        <div class="time">${timeAgo}</div>
      </div>
    </div>`;
  }).join('');
}

// Render a small <img> for a feed favicon. Returns '' if none provided.
// `onerror` hides the img so a broken icon URL never leaves a broken-image
// placeholder next to the source name — the text alone is the fallback.
function renderFavicon(url) {
  if (!url) return '';
  const safe = escapeHtml(url);
  return `<img class="source-favicon" src="${safe}" alt="" loading="lazy" onerror="this.style.display='none'">`;
}

// Render a small <img> for an ESPN team or league logo. Same broken-icon
// guard as renderFavicon. `klass` lets callers pick the size variant
// ('team-logo', 'league-logo', 'team-logo-sm' for the ticker).
function renderLogo(url, klass) {
  if (!url) return '';
  const safe = escapeHtml(url);
  return `<img class="${klass}" src="${safe}" alt="" loading="lazy" onerror="this.style.display='none'">`;
}

// Render the "Away vs Home" matchup with team logos when available.
// Falls back to the plain matchup string for events that have no team
// data (golf, SC2, etc.) or where logos weren't resolved.
function renderMatchup(item, logoClass) {
  if (item && item.awayName && item.homeName) {
    return `
      <span class="team-row">${renderLogo(item.awayLogo, logoClass)}<span>${escapeHtml(item.awayName)}</span></span>
      <span class="vs-sep">vs</span>
      <span class="team-row">${renderLogo(item.homeLogo, logoClass)}<span>${escapeHtml(item.homeName)}</span></span>
    `;
  }
  return escapeHtml(item?.matchup || '');
}

function showNewsDetail(article) {
  const popup = document.getElementById('newsPopup');
  const content = document.getElementById('newsPopupContent');
  const timeAgo = getTimeAgo(article.pubDate);
  // Inject favicon + source name into the popup header. Using innerHTML
  // here (instead of textContent) so the small <img> can sit alongside
  // the title text; escapeHtml() guards the source string.
  const titleEl = document.querySelector('.news-chat-title');
  titleEl.innerHTML = `${renderFavicon(article.favicon)}${escapeHtml(article.source || 'Article')}`;
  content.innerHTML = `
    <div class="popup-title">${escapeHtml(article.title)}</div>
    <div class="popup-time">${timeAgo}</div>
    <div class="popup-body">${escapeHtml(article.snippet)}${article.snippet ? '...' : ''}</div>
    <a href="#" onclick="openArticlePopup('${escapeHtml(article.link).replace(/'/g, "\\'")}'); return false;" class="popup-link">Read Full Article &rarr;</a>
  `;
  popup.classList.add('visible');
}

function closeNewsPopup() {
  document.getElementById('newsPopup').classList.remove('visible');
}

async function initNews() {
  try {
    const res = await fetch('/api/news-categories');
    const categories = await res.json();
    allNewsCategoriesList = categories;
    const tabsContainer = document.getElementById('newsCategoryTabs');
    tabsContainer.innerHTML = categories.map((cat, i) =>
      `<button class="tab-btn ${i === 0 ? 'active' : ''}" data-category="${cat}">${cat}</button>`
    ).join('');

    tabsContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-btn')) {
        tabsContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        loadNewsCategory(e.target.dataset.category);
      }
    });

    if (categories.length > 0) {
      loadNewsCategory(categories[0]);
    }

    // Update stat
    const totalSources = categories.reduce((sum, cat) => sum + 5, 0); // approximate
    document.getElementById('statSources').textContent = categories.length + ' feeds';
  } catch (e) {
    document.getElementById('newsScrollArea').innerHTML =
      '<div class="loading-spinner">Failed to connect to server</div>';
  }
}

// --- Weather ---
let weatherData = null;

const LOCATION_COORDS = {
  chantilly: { lat: 38.8942, lon: -77.4311 },
  cincinnati: { lat: 39.1031, lon: -84.5120 },
};

function buildRadarUrl(lat, lon) {
  const settings = {
    agenda: { id: 'local', center: [lon, lat], location: null, zoom: 10, filter: null, layer: 'sr_bref', station: null },
    animating: false, base: 'standard', artcc: false, county: false, cwa: false, rfc: false, state: false, menu: true, shortFusedOnly: true,
    opacity: { alerts: 0.8, local: 0.6, localStations: 0.8, national: 0.6 }
  };
  return 'https://radar.weather.gov/?settings=v1_' + encodeURIComponent(btoa(JSON.stringify(settings)));
}

function buildWindyUrl(lat, lon, overlay = 'satellite') {
  // Windy embed centered on the given location with configurable overlay
  // CAPE index zooms in closer for better detail
  const zoom = overlay === 'cape' ? 9 : 7;
  return `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&width=650&height=450&zoom=${zoom}&level=surface&overlay=${overlay}&product=ecmwf&menu=&message=true&marker=true&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1`;
}

function switchWindyOverlay(overlay, btn) {
  const iframe = document.querySelector('.wx-detail-windy-bottom iframe');
  if (!iframe) return;
  const currentLat = iframe.dataset.lat;
  const currentLon = iframe.dataset.lon;
  if (!currentLat || !currentLon) return;
  iframe.src = buildWindyUrl(parseFloat(currentLat), parseFloat(currentLon), overlay);
  // Update active button state
  document.querySelectorAll('.windy-toggle-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Update title to reflect selection
  const titleEl = document.querySelector('.wx-detail-section-title .windy-current');
  if (titleEl) titleEl.textContent = overlay === 'cape' ? 'CAPE Index' : 'Satellite Map';
}

async function loadWeather() {
  const scrollArea = document.getElementById('weatherScrollArea');
  scrollArea.innerHTML = '<div class="loading-spinner">Loading weather...</div>';
  try {
    const res = await fetch('/api/weather');
    weatherData = await res.json();
    // Render whichever location tab is active
    const activeTab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    const activeLoc = activeTab ? activeTab.dataset.location : 'chantilly';
    if (activeLoc === 'pivotal') {
      renderPivotalSidebar();
    } else {
      // If weather-swap is on, the sidebar is showing events instead —
      // skip rendering forecast cards into it and just refresh the
      // ticker (which is currently showing the forecast).
      if (isWeatherSwapped) {
        const areaEl = document.getElementById('weatherScrollArea');
        renderEventsIntoArea(cachedScheduleData, areaEl);
        renderWeatherInTicker(activeLoc);
      } else {
        renderWeatherSidebar(activeLoc);
      }
    }
    setupWeatherTabs();
    // Refresh the bottom-left logo/alert badge in case any locations
    // now have (or no longer have) active alerts.
    updateLogoAlert();
  } catch (e) {
    scrollArea.innerHTML =
      '<div class="loading-spinner">Weather data unavailable</div>';
  }
}

function setupWeatherTabs() {
  const tabs = document.getElementById('weatherLocationTabs');
  tabs.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      tabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const loc = e.target.dataset.location;
      // When weather-swap is active, the sidebar is showing the events
      // list — we mustn't clobber it by re-rendering forecast cards.
      // Just route the new location's forecast into the ticker and keep
      // the ticker's location-selector mirror in sync.
      if (isWeatherSwapped) {
        if (loc !== 'pivotal' && loc !== 'browserLocation') {
          renderWeatherInTicker(loc);
        }
        syncTickerLocations();
      } else if (loc === 'pivotal') {
        renderPivotalSidebar();
      } else if (loc === 'browserLocation') {
        renderBrowserLocationWeather();
      } else {
        renderWeatherSidebar(loc);
      }
    }
  });
}

// 1992 Weather Channel retro icons
function wxIconImg(filename) {
  return `<img src="/icons/wx/${filename}" alt="${filename.replace('.gif','')}" class="wx-icon-img">`;
}

// Rough night detection from the local browser clock.
// Treats 7 PM – 6 AM as night; good enough for picking the sun-vs-moon icon.
function isNightNow() {
  const h = new Date().getHours();
  return h < 6 || h >= 19;
}

// Map between day-variant and night-variant icons for the pairs we have.
// (The retro set doesn't include every pair; anything not listed passes through.)
const WX_DAY_FROM_NIGHT = {
  'Clear.gif':        'Sunny.gif',
  'Mostly-Clear.gif': 'Sunny.gif',        // no "Mostly-Sunny" in set — use Sunny
  'Partly-Clear.gif': 'Partly-Cloudy.gif',
};
const WX_NIGHT_FROM_DAY = {
  'Sunny.gif':         'Clear.gif',
  'Partly-Cloudy.gif': 'Partly-Clear.gif',
};

// Pick the best-matching retro icon filename for a condition string.
// Returns just the filename — caller decides day/night and wraps in <img>.
function pickWxIconFile(condition) {
  const lower = (condition || '').toLowerCase();

  // Thunderstorms (check before rain/snow)
  if (lower.includes('thundersnow')) return 'ThunderSnow.gif';
  if (lower.includes('thunderstorm') || (lower.includes('thunder') && lower.includes('storm'))) return 'Thunderstorm.gif';
  if (lower.includes('thunder') || lower.includes('tstm') || lower.includes('lightning')) return 'Thunder.gif';

  // Wintry mix / combination precip
  if (lower.includes('wintry mix') || (lower.includes('rain') && lower.includes('snow') && lower.includes('sleet'))) return 'Wintry-Mix.gif';
  if (lower.includes('freezing rain') && lower.includes('sleet')) return 'Freezing-Rain-Sleet.gif';
  if (lower.includes('freezing rain') || lower.includes('freezing drizzle')) return 'Freezing-Rain.gif';
  if ((lower.includes('rain') && lower.includes('snow')) || (lower.includes('snow') && lower.includes('rain'))) return 'Rain-Snow.gif';
  if ((lower.includes('snow') && lower.includes('sleet')) || (lower.includes('sleet') && lower.includes('snow'))) return 'Snow-Sleet.gif';
  if ((lower.includes('ice') && lower.includes('snow'))) return 'Ice-Snow.gif';
  if (lower.includes('sleet') || lower.includes('ice pellet')) return 'Sleet.gif';

  // Snow
  if (lower.includes('blowing snow') || lower.includes('blizzard')) return 'Blowing-Snow.gif';
  if (lower.includes('heavy snow')) return 'Heavy-Snow.gif';
  if (lower.includes('light snow') || lower.includes('flurr') || lower.includes('snow shower')) return 'Light-Snow.gif';
  if (lower.includes('snow')) return 'Light-Snow.gif';

  // Rain / showers
  if (lower.includes('shower') || lower.includes('scattered') || lower.includes('drizzle') || lower.includes('sprinkle')) return 'Shower.gif';
  if (lower.includes('rain')) return 'Rain.gif';

  // Cloud cover
  if (lower.includes('mostly cloudy') || lower.includes('considerable cloud')) return 'Mostly-Cloudy.gif';
  if (lower.includes('partly cloudy')) return 'Partly-Cloudy.gif';
  if (lower.includes('partly sunny') || lower.includes('partly clear')) return 'Partly-Clear.gif';
  if (lower.includes('mostly sunny') || lower.includes('mostly clear')) return 'Mostly-Clear.gif';
  if (lower.includes('cloudy') || lower.includes('overcast')) return 'Cloudy.gif';

  // Clear / sunny
  if (lower.includes('sunny') || lower.includes('fair')) return 'Sunny.gif';
  if (lower.includes('clear')) return 'Clear.gif';

  // Fog/haze/mist — use Cloudy as closest match
  if (lower.includes('fog') || lower.includes('mist') || lower.includes('haze')) return 'Cloudy.gif';

  // Wind — use Partly-Cloudy as fallback
  if (lower.includes('wind')) return 'Partly-Cloudy.gif';

  // Default — go with the day variant so the forecast never accidentally
  // shows a moon when we don't know what the condition is.
  return 'Partly-Cloudy.gif';
}

// timeOfDay: 'day' (default, used for the 7-day forecast), 'night', or 'auto'
// (uses the browser clock — used for the bottom-right current-conditions widget).
function getWxIcon(condition, timeOfDay = 'day') {
  if (timeOfDay === 'auto') timeOfDay = isNightNow() ? 'night' : 'day';
  let file = pickWxIconFile(condition);
  const map = timeOfDay === 'night' ? WX_NIGHT_FROM_DAY : WX_DAY_FROM_NIGHT;
  if (map[file]) file = map[file];
  return wxIconImg(file);
}

function renderWeatherSidebar(locationKey) {
  const scrollArea = document.getElementById('weatherScrollArea');
  if (!weatherData || !weatherData[locationKey]) {
    scrollArea.innerHTML = '<div class="loading-spinner">No data for this location</div>';
    return;
  }

  const loc = weatherData[locationKey];
  const alertsHtml = renderAlertsBanner(loc.alerts, locationKey);
  const daysHtml = loc.daily.map((day, i) =>
    `<div class="weather-day-card" onclick='showWeatherDetail("${locationKey}", ${i})'>
      <div class="wx-icon">${getWxIcon(day.condition)}</div>
      <div class="wx-info">
        <div class="wx-day">${day.dayName} <span class="wx-date">${day.date}</span></div>
        <div class="wx-desc">${escapeHtml(day.condition)}</div>
      </div>
      <div class="wx-temps">
        <div class="wx-high" style="color:${getTempColor(day.high)}">${day.high}&deg;</div>
        <div class="wx-low" style="color:${getTempColor(day.low)}">${day.low}&deg;</div>
      </div>
    </div>`
  ).join('');
  scrollArea.innerHTML = alertsHtml + daysHtml;
}

// ===== NWS Weather Alerts =====
// Active alerts (watches / warnings / advisories) are attached to each
// location's payload by the server. Render them as clickable banners
// at the top of the weather view; clicking opens a bottom-right popup
// with full headline / area / description / instruction details.

// Map an alert's severity + bucket to a CSS modifier class so we can
// color-code (warnings red, watches orange, advisories yellow).
function alertCssClass(alert) {
  if (!alert) return '';
  const sev = (alert.severity || '').toLowerCase();
  if (sev === 'extreme') return 'wx-alert--extreme';
  if (alert.bucket === 'warning') return 'wx-alert--warning';
  if (alert.bucket === 'watch')   return 'wx-alert--watch';
  if (alert.bucket === 'advisory')return 'wx-alert--advisory';
  return 'wx-alert--statement';
}

// Build the alerts banner block. Returns '' when there are no alerts.
// We cache the alert objects on a window-level map keyed by id so the
// inline onclick handler can look them up without serializing JSON
// into the DOM (descriptions can be many KB).
const _wxAlertCache = new Map();
function renderAlertsBanner(alerts, locationKey) {
  if (!Array.isArray(alerts) || alerts.length === 0) return '';
  const items = alerts.map((a, i) => {
    const id = a.id || `${locationKey}|${i}`;
    _wxAlertCache.set(id, a);
    const safeId = id.replace(/'/g, "\\'");
    return `
      <div class="wx-alert ${alertCssClass(a)}" onclick="showWeatherAlertPopup('${escapeHtml(safeId)}')">
        <span class="wx-alert-icon" aria-hidden="true">&#9888;</span>
        <div class="wx-alert-body">
          <div class="wx-alert-event">${escapeHtml(a.event)}</div>
          <div class="wx-alert-area">${escapeHtml(a.areaDesc || '')}</div>
        </div>
      </div>
    `;
  }).join('');
  return `<div class="wx-alerts-banner">${items}</div>`;
}

function showWeatherAlertPopup(alertId) {
  const alert = _wxAlertCache.get(alertId);
  if (!alert) return;
  const popup = document.getElementById('weatherAlertPopup');
  const titleEl = document.getElementById('weatherAlertTitle');
  const content = document.getElementById('weatherAlertContent');

  titleEl.innerHTML = `<span class="wx-alert-pop-pill ${alertCssClass(alert)}">${escapeHtml(alert.event)}</span>`;

  // Render the alert detail. Description and instruction often have
  // their own line breaks — convert newlines to <br> so they read.
  const desc = escapeHtml(alert.description || '').replace(/\n/g, '<br>');
  const inst = escapeHtml(alert.instruction || '').replace(/\n/g, '<br>');
  const effective = alert.effective ? new Date(alert.effective).toLocaleString() : '';
  const expires   = alert.expires   ? new Date(alert.expires).toLocaleString()   : '';

  content.innerHTML = `
    <div class="wx-alert-pop-headline">${escapeHtml(alert.headline || alert.event)}</div>
    ${alert.areaDesc ? `<div class="wx-alert-pop-area"><strong>Area:</strong> ${escapeHtml(alert.areaDesc)}</div>` : ''}
    <div class="wx-alert-pop-meta">
      ${effective ? `<span><strong>Effective:</strong> ${escapeHtml(effective)}</span>` : ''}
      ${expires   ? `<span><strong>Expires:</strong> ${escapeHtml(expires)}</span>`     : ''}
      <span><strong>Severity:</strong> ${escapeHtml(alert.severity)}</span>
      <span><strong>Urgency:</strong> ${escapeHtml(alert.urgency)}</span>
    </div>
    ${desc ? `<div class="wx-alert-pop-section"><strong>Details</strong><div>${desc}</div></div>` : ''}
    ${inst ? `<div class="wx-alert-pop-section wx-alert-pop-instruction"><strong>What to do</strong><div>${inst}</div></div>` : ''}
    <div class="wx-alert-pop-source">Source: ${escapeHtml(alert.sender || 'NWS')}</div>
  `;
  popup.classList.add('visible');
}

function closeWeatherAlertPopup() {
  document.getElementById('weatherAlertPopup').classList.remove('visible');
}

// When any active alert exists across all loaded locations, replace
// the bottom-left MNV logo with a clickable alert badge. The badge
// shows the highest-severity event + the affected location and opens
// the bottom-right weather-alert popup on click. Cleared (logo
// restored) when no alerts are active.
function updateLogoAlert() {
  const logoArea = document.getElementById('logoArea');
  const mnvLogo  = document.getElementById('mnvLogo');
  if (!logoArea || !mnvLogo) return;

  // Aggregate every active alert across the static locations and the
  // browser-location data, tagging each with its source location name
  // so the badge can show "Tornado Watch — Chantilly, VA".
  const all = [];
  if (weatherData && typeof weatherData === 'object') {
    Object.values(weatherData).forEach(loc => {
      if (Array.isArray(loc?.alerts)) {
        loc.alerts.forEach(a => all.push({ ...a, _locName: loc.name || '' }));
      }
    });
  }
  if (browserLocationWeather?.alerts) {
    browserLocationWeather.alerts.forEach(a => all.push({
      ...a,
      _locName: browserLocationWeather.name || 'Browser Location',
    }));
  }

  // Dedupe by id; rank by severity (server already sorted within each
  // location, but inter-location order isn't guaranteed).
  const SEV = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
  const seen = new Set();
  const unique = [];
  for (const a of all) {
    const key = a.id || `${a.event}|${a._locName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(a);
  }
  unique.sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));

  let badge = document.getElementById('tickerLogoAlertBadge');

  if (unique.length === 0) {
    // All clear — restore the MNV logo, hide the badge.
    if (badge) badge.style.display = 'none';
    mnvLogo.style.display = '';
    return;
  }

  // Make sure the popup can look up the chosen alert by id even if no
  // sidebar banner has been rendered yet (e.g. weather-swap is on so
  // the sidebar shows events instead).
  const top = unique[0];
  if (top.id) _wxAlertCache.set(top.id, top);

  // Build the badge lazily; reuse on subsequent updates.
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'tickerLogoAlertBadge';
    badge.type = 'button';
    badge.className = 'ticker-logo-alert';
    // Insert before the MNV svg so it occupies the same spot.
    logoArea.insertBefore(badge, mnvLogo);
  }

  // If multiple alerts, surface the count so users know to click for
  // the full list (via the sidebar banners; popup shows one at a time).
  const extra = unique.length > 1 ? `<span class="ticker-logo-alert-count">+${unique.length - 1}</span>` : '';
  badge.className = `ticker-logo-alert ${alertCssClass(top)}`;
  badge.innerHTML = `
    <span class="ticker-logo-alert-icon" aria-hidden="true">&#9888;</span>
    <span class="ticker-logo-alert-body">
      <span class="ticker-logo-alert-event">${escapeHtml(top.event)}</span>
      <span class="ticker-logo-alert-loc">${escapeHtml(top._locName || '')}</span>
    </span>
    ${extra}
  `;
  badge.title = `${top.event} — ${top._locName || ''}\nClick for details`;
  badge.onclick = () => { if (top.id) showWeatherAlertPopup(top.id); };
  badge.style.display = '';
  mnvLogo.style.display = 'none';
}

function showWeatherscanVideo() {
  document.getElementById('weatherscanFrame').src = 'https://v1.weatherscan.net/';
  document.querySelector('#weatherscanContent h2').textContent = 'Weatherscan Live';
  showPanel('weatherscanPanel');
}

function showDWLive() {
  const main = document.getElementById('mainContent');
  const rect = main.getBoundingClientRect();
  const ticker = document.getElementById('tickerBar');
  const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
  const left = window.screenX + rect.left;
  const top = window.screenY + rect.top + (window.outerHeight - window.innerHeight);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height - tickerH);
  window.open(
    'https://www.youtube.com/watch?v=LuKwFajn37Ur',
    'dwLive',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  );
}

async function showWeatherRadar() {
  let lat, lon;
  if (currentLocation && !currentLocation.auto) {
    lat = currentLocation.lat;
    lon = currentLocation.lon;
  } else {
    lat = 39.167; lon = -84.527;
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      lat = parseFloat(pos.coords.latitude.toFixed(3));
      lon = parseFloat(pos.coords.longitude.toFixed(3));
    } catch (e) {
      console.log('[Radar] Geolocation unavailable, using default location');
    }
  }

  const settings = {
    agenda: { id: 'local', center: [lon, lat], location: null, zoom: 10, filter: null, layer: 'sr_bref', station: null },
    animating: false, base: 'standard', artcc: false, county: false, cwa: false, rfc: false, state: false, menu: true, shortFusedOnly: true,
    opacity: { alerts: 0.8, local: 0.6, localStations: 0.8, national: 0.6 }
  };
  const encoded = btoa(JSON.stringify(settings));
  const radarUrl = 'https://radar.weather.gov/?settings=v1_' + encodeURIComponent(encoded);

  document.getElementById('weatherscanFrame').src = radarUrl;
  document.querySelector('#weatherscanContent h2').textContent = 'NWS Weather Radar';
  showPanel('weatherscanPanel');
}

function showESPNLive() {
  const main = document.getElementById('mainContent');
  const rect = main.getBoundingClientRect();
  const ticker = document.getElementById('tickerBar');
  const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
  const left = window.screenX + rect.left;
  const top = window.screenY + rect.top + (window.outerHeight - window.innerHeight);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height - tickerH);
  window.open(
    'https://www.espn.com/watch/collections/31b3b91f-303c-4a4c-9ea9-a6880ce36f25/live-upcoming',
    'espnLive',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  );
}

function showYouTubeTV() {
  const main = document.getElementById('mainContent');
  const rect = main.getBoundingClientRect();
  const ticker = document.getElementById('tickerBar');
  const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
  const left = window.screenX + rect.left;
  const top = window.screenY + rect.top + (window.outerHeight - window.innerHeight);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height - tickerH);
  window.open(
    'https://tv.youtube.com/',
    'youtubeTVLive',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  );
}

// Open a sports game / stream link in a popup sized to the main content
// panel (same sizing as the ESPN/DW live popups, so it doesn't overlap
// the bottom ticker).
function showGamePopup(url) {
  if (!url) return;
  const main = document.getElementById('mainContent');
  const rect = main.getBoundingClientRect();
  const ticker = document.getElementById('tickerBar');
  const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
  const left = window.screenX + rect.left;
  const top = window.screenY + rect.top + (window.outerHeight - window.innerHeight);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height - tickerH);
  window.open(
    url,
    'gamePopup',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  );
}

function openArticlePopup(url) {
  const main = document.getElementById('mainContent');
  const rect = main.getBoundingClientRect();
  const ticker = document.getElementById('tickerBar');
  const tickerH = ticker ? ticker.getBoundingClientRect().height : 0;
  const width = Math.round(rect.width / 2);
  const height = Math.round((rect.height - tickerH) / 2);
  const left = window.screenX + rect.left + Math.round(rect.width / 4);
  const top = window.screenY + rect.top + (window.outerHeight - window.innerHeight) + Math.round((rect.height - tickerH) / 4);
  window.open(
    url,
    'articlePopup',
    `width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`
  );
}

function renderPivotalSidebar() {
  const scrollArea = document.getElementById('weatherScrollArea');
  scrollArea.innerHTML = `
    <div class="pivotal-card" onclick="showPanel('pivotalPanel')">
      <div class="wx-day">ECMWF AIFS Forecast</div>
      <div class="wx-desc" style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
        Surface Temperature - CONUS<br>Click to view animated GIF
      </div>
      <img src="/api/pivotal-gif" alt="Pivotal Weather Preview" style="margin-top:8px;opacity:0.8;" onerror="this.style.display='none'"/>
    </div>
  `;
}

function showWeatherDetail(locationKey, dayIndex) {
  const loc = weatherData[locationKey];
  const day = loc.daily[dayIndex];
  const content = document.getElementById('weatherDetailContent');
  const coords = LOCATION_COORDS[locationKey];
  const radarUrl = coords ? buildRadarUrl(coords.lat, coords.lon) : '';
  const windyUrl = coords ? buildWindyUrl(coords.lat, coords.lon) : '';
  const windyLat = coords ? coords.lat : '';
  const windyLon = coords ? coords.lon : '';

  content.innerHTML = `
    <h2><span class="wx-detail-icon">${getWxIcon(day.condition)}</span> ${day.dayName} - ${loc.name}</h2>
    <p class="wx-detail-subtitle">${day.date}</p>
    ${renderAlertsBanner(loc.alerts, locationKey)}
    <div class="wx-detail-split">
      <div class="wx-detail-data">
        <div class="wx-detail-grid">
          <div class="wx-detail-stat">
            <div class="label">High</div>
            <div class="value temp-high" style="color:${getTempColor(day.high)}">${day.high}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Low</div>
            <div class="value temp-low" style="color:${getTempColor(day.low)}">${day.low}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Dew Point</div>
            <div class="value">${day.dewPoint}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Wind</div>
            <div class="value">${day.wind}</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Cloud Cover</div>
            <div class="value">${day.cloudCover}%</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Precip Chance</div>
            <div class="value">${day.precipChance}%</div>
          </div>
        </div>
        <div class="wx-forecast-text">
          <strong>Forecast:</strong> ${escapeHtml(day.forecastText)}
        </div>
      </div>
      <div class="wx-detail-chart-side">
        <div class="chart-container">
          <canvas id="wxTrendChart"></canvas>
        </div>
      </div>
    </div>
    ${radarUrl ? `<div class="wx-detail-radar-bottom">
      <iframe src="${radarUrl}" style="width:100%;height:100%;border:none;border-radius:8px;" allowfullscreen></iframe>
    </div>` : ''}
    ${windyUrl ? `<div class="wx-detail-section-title">
      Windy <span class="windy-current">Satellite Map</span>
      <div class="windy-toggle-group">
        <button class="windy-toggle-btn active" onclick="switchWindyOverlay('satellite', this)">Satellite</button>
        <button class="windy-toggle-btn" onclick="switchWindyOverlay('cape', this)">CAPE Index</button>
      </div>
    </div>
    <div class="wx-detail-windy-bottom">
      <iframe src="${windyUrl}" data-lat="${windyLat}" data-lon="${windyLon}" style="width:100%;height:100%;border:none;border-radius:8px;" allowfullscreen></iframe>
    </div>` : ''}
  `;

  showPanel('weatherDetailPanel');

  // Render trend chart
  setTimeout(() => renderWeatherChart(loc), 100);
}

function renderWeatherChart(loc) {
  const ctx = document.getElementById('wxTrendChart');
  if (!ctx) return;

  // Destroy old chart if exists
  if (window._wxChart) window._wxChart.destroy();

  const labels = loc.daily.map(d => d.dayName);
  const isDark = html.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#8b95a8' : '#4a5568';

  window._wxChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'High Temp (\u00B0F)',
          data: loc.daily.map(d => d.high),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.1)',
          tension: 0.4, fill: false, pointRadius: 4,
        },
        {
          label: 'Low Temp (\u00B0F)',
          data: loc.daily.map(d => d.low),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          tension: 0.4, fill: false, pointRadius: 4,
        },
        {
          label: 'Dew Point (\u00B0F)',
          data: loc.daily.map(d => d.dewPoint),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.4, fill: false, pointRadius: 3, borderDash: [4, 4],
        },
        {
          label: 'Wind (mph)',
          data: loc.daily.map(d => parseInt(d.wind) || 0),
          borderColor: '#8b5cf6',
          tension: 0.4, fill: false, pointRadius: 3, borderDash: [2, 2],
        },
        {
          label: 'Cloud Cover (%)',
          data: loc.daily.map(d => d.cloudCover),
          borderColor: '#6b7280',
          tension: 0.4, fill: false, pointRadius: 3, borderDash: [6, 3],
        },
        {
          label: 'Precip (%)',
          data: loc.daily.map(d => d.precipChance),
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6,182,212,0.08)',
          tension: 0.4, fill: true, pointRadius: 3,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: textColor, font: { size: 12, weight: 'bold' }, boxWidth: 12 }
        }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 12, weight: 'bold' } }, grid: { color: gridColor } },
        y: { min: 0, max: 100, ticks: { color: textColor, font: { size: 12, weight: 'bold' } }, grid: { color: gridColor } }
      }
    }
  });
}

// --- Ticker ---
async function loadSchedule() {
  try {
    const res = await fetch('/api/schedule');
    const data = await res.json();
    cachedScheduleData = data;
    document.getElementById('statSports').textContent = data.length;
    if (isSwapped) {
      renderEventsSidebar(data);
    } else {
      renderTicker(data);
    }
  } catch (e) {
    // Try SC2 events separately
    try {
      const sc2Res = await fetch('/api/sc2events');
      const sc2 = await sc2Res.json();
      cachedScheduleData = sc2.map(ev => ({
        sport: 'SC2',
        matchup: ev.name,
        network: 'Online',
        time: ev.time,
        link: ev.link
      }));
      if (isSwapped) {
        renderEventsSidebar(cachedScheduleData);
      } else {
        renderTicker(cachedScheduleData);
      }
    } catch (e2) {
      document.getElementById('tickerTrack').innerHTML =
        '<span class="ticker-loading">Schedule unavailable</span>';
    }
  }
}

// Shared play-icon / clickability logic for an event, used by both the
// events sidebar and the bottom ticker so they stay visually identical.
// Returns the clickable flag, the inline onclick attribute, and the
// colored ▶ icon markup. State by start time:
//   • not started yet   -> accent  (upcoming)
//   • started <= 5h ago  -> green   (likely live)
//   • started > 5h ago   -> red     (likely over / stale link)
// Events past 5h are filtered out entirely by filterFreshEvents() before
// they reach the renderer, so the stale state is just a safety net.
function buildEventWatch(item) {
  const rawLink = (item && item.link ? String(item.link) : '').trim();
  const isClickable = !!rawLink;
  const safeLink = rawLink.replace(/'/g, "\\'");

  let watchStateClass = 'event-watch--upcoming';
  let watchTitle = 'Watch';
  const startMs = item && item.sortTime ? new Date(item.sortTime).getTime() : NaN;
  if (Number.isFinite(startMs)) {
    const ageMs = Date.now() - startMs;
    const FIVE_HOURS = 5 * 60 * 60 * 1000;
    if (ageMs >= FIVE_HOURS) {
      watchStateClass = 'event-watch--stale';
      watchTitle = 'Started over 5h ago';
    } else if (ageMs >= 0) {
      watchStateClass = 'event-watch--live';
      watchTitle = 'In progress';
    }
  }

  const clickAttr = isClickable
    ? `onclick="showGamePopup('${escapeHtml(safeLink)}'); return false;"`
    : '';
  const watchHint = isClickable
    ? `<span class="event-watch ${watchStateClass}" title="${watchTitle}">&#9654;</span>`
    : '';
  return { isClickable, clickAttr, watchHint };
}

function renderTicker(items) {
  const track = document.getElementById('tickerTrack');
  const sorted = sortEvents(items);
  if (!sorted.length) {
    track.innerHTML = '<span class="ticker-loading">No events scheduled</span>';
    return;
  }
  const itemsHtml = sorted.map(item => {
    const { isClickable, clickAttr, watchHint } = buildEventWatch(item);
    const cls = isClickable ? 'ticker-item ticker-item-clickable' : 'ticker-item';
    return `
    <div class="${cls}" ${clickAttr}>
      <span class="sport-badge ${getSportClass(item.sport)}">${renderLogo(item.leagueLogo, 'league-logo')}${escapeHtml(item.sport)}</span>
      <span class="matchup">${renderMatchup(item, 'team-logo-sm')}</span>
      <span class="network">${escapeHtml(item.network || '')}</span>
      <span class="time">${escapeHtml(item.time || '')}</span>
      ${watchHint}
    </div>
  `;
  }).join('');

  // Duplicate for seamless scrolling
  track.innerHTML = itemsHtml + itemsHtml;

  // Adjust animation speed based on content width
  requestAnimationFrame(() => {
    const totalWidth = track.scrollWidth / 2;
    const duration = Math.max(60, totalWidth / 80); // px per second
    track.style.animationDuration = duration + 's';
  });
}

// --- Utilities ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// --- Refresh All ---
document.getElementById('refreshAll').addEventListener('click', async () => {
  const btn = document.getElementById('refreshAll');
  btn.classList.add('refreshing');
  btn.disabled = true;

  try {
    // Clear server cache
    await fetch('/api/refresh', { method: 'POST' });

    // Clear local caches
    allNewsData = {};
    weatherData = null;

    // Reload all data in parallel
    const activeNewsTab = document.querySelector('#newsCategoryTabs .tab-btn.active');
    const activeCategory = activeNewsTab ? activeNewsTab.dataset.category : 'Tech';

    await Promise.all([
      loadNewsCategory(activeCategory, true),
      loadWeather(),
      loadSchedule()
    ]);
  } catch (e) {
    console.error('Refresh failed:', e);
  } finally {
    btn.classList.remove('refreshing');
    btn.disabled = false;
  }
});

// --- Sidebar Resize ---
(function initSidebarResize() {
  const handles = document.querySelectorAll('.sidebar-resize-handle');
  handles.forEach(handle => {
    let startX, startWidth, sidebar;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sidebar = handle.parentElement;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      handle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (e) => {
        const delta = e.clientX - startX;
        const newWidth = Math.max(180, Math.min(500, startWidth + delta));
        sidebar.style.width = newWidth + 'px';
      };

      const onMouseUp = () => {
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Save widths to localStorage
        const id = sidebar.id;
        localStorage.setItem('mnv-' + id + '-width', sidebar.style.width);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });

  // Restore saved widths — but only on desktop. On mobile the dashboard
  // stacks vertically and sidebars need to be 100% wide; restoring a
  // saved desktop width (e.g. 280px) here would leak through as an
  // inline style and make the two sidebars render at different widths.
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  function applySavedWidths() {
    ['newsSidebar', 'weatherSidebar'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isMobile()) {
        // Clear any previously-applied inline width so CSS takes over.
        el.style.width = '';
        return;
      }
      const saved = localStorage.getItem('mnv-' + id + '-width');
      if (saved) el.style.width = saved;
    });
  }
  applySavedWidths();
  // Re-apply on viewport changes (rotation, browser resize) so we don't
  // strand an inline desktop width when the user shrinks past 900px or
  // grows back past it.
  window.matchMedia('(max-width: 900px)').addEventListener?.('change', applySavedWidths);
})();

// --- Auto Refresh ---
let autoRefreshInterval = null;
let autoRefreshCountdown = null;
let autoRefreshSecondsLeft = 0;
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10 minutes
const AUTO_REFRESH_SECS = AUTO_REFRESH_MS / 1000;

function formatCountdown(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function setAutoRefresh(enabled) {
  const btn = document.getElementById('autoRefreshToggle');
  const status = btn.querySelector('.auto-status');

  // Clear any existing timers
  if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
  if (autoRefreshCountdown) { clearInterval(autoRefreshCountdown); autoRefreshCountdown = null; }

  if (enabled) {
    autoRefreshSecondsLeft = AUTO_REFRESH_SECS;
    status.textContent = formatCountdown(autoRefreshSecondsLeft);
    btn.classList.add('auto-on');
    localStorage.setItem('mnv-auto-refresh', '1');

    // Countdown ticker every second
    autoRefreshCountdown = setInterval(() => {
      autoRefreshSecondsLeft--;
      if (autoRefreshSecondsLeft <= 0) {
        autoRefreshSecondsLeft = AUTO_REFRESH_SECS;
        // Refresh only the news feeds in place — no page reload. The
        // Full Auto-Refresh (1h) still does a full browser reload; this
        // one is intentionally lighter so the user's scroll position,
        // open panels, and selected tab survive the refresh.
        (async () => {
          console.log('[AutoRefresh] Refreshing news feeds...');
          allNewsData = {};
          const activeNewsTab = document.querySelector('#newsCategoryTabs .tab-btn.active');
          const activeCategory = activeNewsTab ? activeNewsTab.dataset.category : 'Tech';
          await loadNewsCategory(activeCategory, true);
        })();
      }
      status.textContent = formatCountdown(autoRefreshSecondsLeft);
    }, 1000);
  } else {
    status.textContent = 'OFF';
    btn.classList.remove('auto-on');
    localStorage.setItem('mnv-auto-refresh', '0');
  }
}

document.getElementById('autoRefreshToggle').addEventListener('click', () => {
  setAutoRefresh(!autoRefreshInterval);
});

// Restore auto-refresh state
if (localStorage.getItem('mnv-auto-refresh') === '1') {
  setAutoRefresh(true);
}

// --- Auto-Scroll Left Panel (matches ticker speed, cycles categories at bottom) ---
// Ticker anim: 120s for 50% of track, ~20 px/sec perceptual. Match with vertical scroll.
const AUTO_SCROLL_PX_PER_SEC = 20;
const AUTO_SCROLL_PAUSE_AT_TOP_MS = 800;
const AUTO_SCROLL_PAUSE_AT_BOTTOM_MS = 1500;
let autoScrollRafId = null;
let autoScrollLastTs = 0;
let autoScrollAcc = 0;
let autoScrollPaused = false;

function getScrollingArea() {
  // In swapped mode, the left panel shows events via #newsScrollArea (same element)
  return document.getElementById('newsScrollArea');
}

function cycleLeftPanelCategoryOrSort() {
  if (isSwapped) {
    // Events mode: toggle sort between time and sport
    const next = eventSortMode === 'time' ? 'sport' : 'time';
    setEventSort(next);
  } else {
    // News mode: move to next category tab (wrap around)
    const tabs = Array.from(document.querySelectorAll('#newsCategoryTabs .tab-btn'));
    if (!tabs.length) return;
    const currentIdx = tabs.findIndex(t => t.classList.contains('active'));
    const nextIdx = (currentIdx + 1) % tabs.length;
    tabs[currentIdx]?.classList.remove('active');
    tabs[nextIdx].classList.add('active');
    loadNewsCategory(tabs[nextIdx].dataset.category);
  }
}

function autoScrollStep(ts) {
  if (!autoScrollRafId) return;
  if (!autoScrollLastTs) autoScrollLastTs = ts;
  const dt = ts - autoScrollLastTs;
  autoScrollLastTs = ts;

  if (!autoScrollPaused) {
    autoScrollAcc += (AUTO_SCROLL_PX_PER_SEC * dt) / 1000;
    const area = getScrollingArea();
    if (area) {
      const maxScroll = area.scrollHeight - area.clientHeight;
      if (maxScroll <= 0) {
        // Not enough content to scroll — just cycle after pause
        autoScrollPaused = true;
        setTimeout(() => {
          cycleLeftPanelCategoryOrSort();
          autoScrollAcc = 0;
          // Wait a bit after category change for the new content to render
          setTimeout(() => { autoScrollPaused = false; autoScrollLastTs = 0; }, AUTO_SCROLL_PAUSE_AT_TOP_MS);
        }, AUTO_SCROLL_PAUSE_AT_BOTTOM_MS);
      } else if (autoScrollAcc >= 1) {
        const delta = Math.floor(autoScrollAcc);
        autoScrollAcc -= delta;
        area.scrollTop = Math.min(area.scrollTop + delta, maxScroll);
        if (area.scrollTop >= maxScroll - 1) {
          // Reached bottom: pause, cycle category, reset to top
          autoScrollPaused = true;
          setTimeout(() => {
            cycleLeftPanelCategoryOrSort();
            autoScrollAcc = 0;
            const a = getScrollingArea();
            if (a) a.scrollTop = 0;
            setTimeout(() => { autoScrollPaused = false; autoScrollLastTs = 0; }, AUTO_SCROLL_PAUSE_AT_TOP_MS);
          }, AUTO_SCROLL_PAUSE_AT_BOTTOM_MS);
        }
      }
    }
  }

  autoScrollRafId = requestAnimationFrame(autoScrollStep);
}

function setAutoScroll(enabled) {
  const btn = document.getElementById('autoScrollToggle');
  const statusSpan = btn.querySelector('.scroll-status');
  if (enabled) {
    if (!autoScrollRafId) {
      autoScrollLastTs = 0;
      autoScrollAcc = 0;
      autoScrollPaused = false;
      autoScrollRafId = requestAnimationFrame(autoScrollStep);
    }
    statusSpan.textContent = 'ON';
    btn.classList.add('auto-on');
    localStorage.setItem('mnv-auto-scroll', '1');
  } else {
    if (autoScrollRafId) {
      cancelAnimationFrame(autoScrollRafId);
      autoScrollRafId = null;
    }
    statusSpan.textContent = 'OFF';
    btn.classList.remove('auto-on');
    localStorage.setItem('mnv-auto-scroll', '0');
  }
}

document.getElementById('autoScrollToggle').addEventListener('click', () => {
  setAutoScroll(!autoScrollRafId);
});

// Pause auto-scroll when the user manually interacts with the sidebar
['wheel', 'touchstart', 'mousedown'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    const area = getScrollingArea();
    if (!area || !autoScrollRafId) return;
    if (area.contains(e.target)) {
      // Briefly pause so user can read without it jumping
      autoScrollPaused = true;
      clearTimeout(window._autoScrollResumeT);
      window._autoScrollResumeT = setTimeout(() => { autoScrollPaused = false; autoScrollLastTs = 0; }, 3000);
    }
  }, { passive: true });
});

// Restore auto-scroll state
if (localStorage.getItem('mnv-auto-scroll') === '1') {
  // Delay slightly so news content is loaded first
  setTimeout(() => setAutoScroll(true), 2000);
}

// --- Full Auto Refresh (1 hour) ---
let fullAutoRefreshCountdown = null;
let fullAutoRefreshSecondsLeft = 0;
const FULL_AUTO_REFRESH_SECS = 60 * 60; // 1 hour

function formatFullCountdown(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function setFullAutoRefresh(enabled) {
  const btn = document.getElementById('fullAutoRefreshToggle');
  const status = btn.querySelector('.full-auto-status');

  if (fullAutoRefreshCountdown) { clearInterval(fullAutoRefreshCountdown); fullAutoRefreshCountdown = null; }

  if (enabled) {
    fullAutoRefreshSecondsLeft = FULL_AUTO_REFRESH_SECS;
    status.textContent = formatFullCountdown(fullAutoRefreshSecondsLeft);
    btn.classList.add('auto-on');
    localStorage.setItem('mnv-full-auto-refresh', '1');

    fullAutoRefreshCountdown = setInterval(() => {
      fullAutoRefreshSecondsLeft--;
      if (fullAutoRefreshSecondsLeft <= 0) {
        fullAutoRefreshSecondsLeft = FULL_AUTO_REFRESH_SECS;
        // Force a server-side cache refresh, then reload the page so the
        // whole client browser refreshes too. The full-auto-refresh-enabled
        // flag is persisted in localStorage so it re-arms after reload.
        (async () => {
          console.log('[FullAutoRefresh] Refreshing all data and reloading page...');
          try {
            await fetch('/api/refresh', { method: 'POST' });
          } catch (e) {
            console.error('[FullAutoRefresh] /api/refresh failed:', e);
          }
          location.reload();
        })();
      }
      status.textContent = formatFullCountdown(fullAutoRefreshSecondsLeft);
    }, 1000);
  } else {
    status.textContent = 'OFF';
    btn.classList.remove('auto-on');
    localStorage.setItem('mnv-full-auto-refresh', '0');
  }
}

document.getElementById('fullAutoRefreshToggle').addEventListener('click', () => {
  setFullAutoRefresh(!fullAutoRefreshCountdown);
});

// Restore full auto-refresh state
if (localStorage.getItem('mnv-full-auto-refresh') === '1') {
  setFullAutoRefresh(true);
}

// --- Browser Location ---
const MAJOR_CITIES = [
  { city: 'New York', state: 'NY', lat: 40.7128, lon: -74.0060 },
  { city: 'Los Angeles', state: 'CA', lat: 34.0522, lon: -118.2437 },
  { city: 'Chicago', state: 'IL', lat: 41.8781, lon: -87.6298 },
  { city: 'Houston', state: 'TX', lat: 29.7604, lon: -95.3698 },
  { city: 'Phoenix', state: 'AZ', lat: 33.4484, lon: -112.0740 },
  { city: 'Philadelphia', state: 'PA', lat: 39.9526, lon: -75.1652 },
  { city: 'San Antonio', state: 'TX', lat: 29.4241, lon: -98.4936 },
  { city: 'San Diego', state: 'CA', lat: 32.7157, lon: -117.1611 },
  { city: 'Dallas', state: 'TX', lat: 32.7767, lon: -96.7970 },
  { city: 'Austin', state: 'TX', lat: 30.2672, lon: -97.7431 },
  { city: 'San Francisco', state: 'CA', lat: 37.7749, lon: -122.4194 },
  { city: 'Seattle', state: 'WA', lat: 47.6062, lon: -122.3321 },
  { city: 'Denver', state: 'CO', lat: 39.7392, lon: -104.9903 },
  { city: 'Washington', state: 'DC', lat: 38.9072, lon: -77.0369 },
  { city: 'Nashville', state: 'TN', lat: 36.1627, lon: -86.7816 },
  { city: 'Boston', state: 'MA', lat: 42.3601, lon: -71.0589 },
  { city: 'Atlanta', state: 'GA', lat: 33.7490, lon: -84.3880 },
  { city: 'Miami', state: 'FL', lat: 25.7617, lon: -80.1918 },
  { city: 'Minneapolis', state: 'MN', lat: 44.9778, lon: -93.2650 },
  { city: 'Tampa', state: 'FL', lat: 27.9506, lon: -82.4572 },
  { city: 'Orlando', state: 'FL', lat: 28.5383, lon: -81.3792 },
  { city: 'Charlotte', state: 'NC', lat: 35.2271, lon: -80.8431 },
  { city: 'Raleigh', state: 'NC', lat: 35.7796, lon: -78.6382 },
  { city: 'Portland', state: 'OR', lat: 45.5152, lon: -122.6784 },
  { city: 'Las Vegas', state: 'NV', lat: 36.1699, lon: -115.1398 },
  { city: 'Detroit', state: 'MI', lat: 42.3314, lon: -83.0458 },
  { city: 'Cincinnati', state: 'OH', lat: 39.1031, lon: -84.5120 },
  { city: 'Cleveland', state: 'OH', lat: 41.4993, lon: -81.6944 },
  { city: 'Columbus', state: 'OH', lat: 39.9612, lon: -82.9988 },
  { city: 'Indianapolis', state: 'IN', lat: 39.7684, lon: -86.1581 },
  { city: 'Kansas City', state: 'MO', lat: 39.0997, lon: -94.5786 },
  { city: 'St. Louis', state: 'MO', lat: 38.6270, lon: -90.1994 },
  { city: 'Pittsburgh', state: 'PA', lat: 40.4406, lon: -79.9959 },
  { city: 'Baltimore', state: 'MD', lat: 39.2904, lon: -76.6122 },
  { city: 'Milwaukee', state: 'WI', lat: 43.0389, lon: -87.9065 },
  { city: 'Salt Lake City', state: 'UT', lat: 40.7608, lon: -111.8910 },
  { city: 'New Orleans', state: 'LA', lat: 29.9511, lon: -90.0715 },
  { city: 'Richmond', state: 'VA', lat: 37.5407, lon: -77.4360 },
  { city: 'Chantilly', state: 'VA', lat: 38.8942, lon: -77.4311 },
  { city: 'Norfolk', state: 'VA', lat: 36.8508, lon: -76.2859 },
  { city: 'San Jose', state: 'CA', lat: 37.3382, lon: -121.8863 },
  { city: 'Jacksonville', state: 'FL', lat: 30.3322, lon: -81.6557 },
  { city: 'Memphis', state: 'TN', lat: 35.1495, lon: -90.0490 },
  { city: 'Oklahoma City', state: 'OK', lat: 35.4676, lon: -97.5164 },
  { city: 'Louisville', state: 'KY', lat: 38.2527, lon: -85.7585 },
  { city: 'Tucson', state: 'AZ', lat: 32.2226, lon: -110.9747 },
  { city: 'Honolulu', state: 'HI', lat: 21.3069, lon: -157.8583 },
  { city: 'Anchorage', state: 'AK', lat: 61.2181, lon: -149.9003 },
];

let currentLocation = null; // { city, state, lat, lon } or null for auto

function toggleLocationDropdown() {
  const dd = document.getElementById('locationDropdown');
  dd.classList.toggle('visible');
  if (dd.classList.contains('visible')) {
    document.getElementById('locationSearch').value = '';
    document.getElementById('locationSearch').focus();
    filterCities('');
  }
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const wrapper = document.querySelector('.location-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('locationDropdown').classList.remove('visible');
  }
});

function filterCities(query) {
  const results = document.getElementById('locationResults');
  const q = query.toLowerCase().trim();
  const filtered = q
    ? MAJOR_CITIES.filter(c => c.city.toLowerCase().includes(q) || c.state.toLowerCase().includes(q))
    : MAJOR_CITIES;

  results.innerHTML = filtered.slice(0, 20).map((c, i) =>
    `<div class="location-result-item" onclick="selectCity(${i}, '${q}')">${c.city}, <span class="result-state">${c.state}</span></div>`
  ).join('');
}

function selectCity(index, query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? MAJOR_CITIES.filter(c => c.city.toLowerCase().includes(q) || c.state.toLowerCase().includes(q))
    : MAJOR_CITIES;
  const city = filtered[index];
  if (!city) return;

  currentLocation = city;
  localStorage.setItem('mnv-location-override', JSON.stringify(city));
  document.getElementById('browserLocation').textContent = `📍 ${city.city}, ${city.state}`;
  document.getElementById('locationDropdown').classList.remove('visible');

  // Update weather tab label
  updateBrowserLocationTab();

  // Fetch weather for this location
  fetchBrowserLocationWeather();

  // Update current conditions with new location
  fetchCurrentWeather();
}

function resetLocation() {
  currentLocation = null;
  localStorage.removeItem('mnv-location-override');
  document.getElementById('locationDropdown').classList.remove('visible');
  document.getElementById('browserLocation').textContent = '📍 detecting...';

  // Re-detect browser location
  fetchBrowserLocationAuto();

  // Update weather tab
  updateBrowserLocationTab();

  // Update current conditions
  fetchCurrentWeather();
}

function updateBrowserLocationTab() {
  const tab = document.querySelector('[data-location="browserLocation"]');
  if (tab) {
    tab.textContent = currentLocation
      ? `${currentLocation.city}, ${currentLocation.state}`
      : 'Browser Location';
  }
}

async function fetchBrowserLocationAuto() {
  let lat = 38.8942, lon = -77.4311;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
    });
    lat = parseFloat(pos.coords.latitude.toFixed(4));
    lon = parseFloat(pos.coords.longitude.toFixed(4));
  } catch (e) {
    console.log('[Location] Geolocation unavailable, using default');
  }

  try {
    const res = await fetch(`https://api.weather.gov/points/${lat},${lon}`, {
      headers: { 'User-Agent': 'MarckNetVision Dashboard' }
    });
    const data = await res.json();
    const city = data.properties?.relativeLocation?.properties?.city || '';
    const state = data.properties?.relativeLocation?.properties?.state || '';
    if (city && state) {
      document.getElementById('browserLocation').textContent = `📍 ${city}, ${state}`;
      // Store detected coords for weather fetch
      currentLocation = { city, state, lat, lon, auto: true };
      updateBrowserLocationTab();
      fetchBrowserLocationWeather();
    }
  } catch (e) {
    console.error('[Location] Failed to fetch:', e);
  }
}

let browserLocationWeather = null;

async function fetchBrowserLocationWeather() {
  if (!currentLocation) return;
  try {
    const res = await fetch(`/api/weather-by-coords?lat=${currentLocation.lat}&lon=${currentLocation.lon}&name=${encodeURIComponent(currentLocation.city + ', ' + currentLocation.state)}`);
    const data = await res.json();
    browserLocationWeather = data;

    // If browser location tab is active, render it
    const activeTab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    if (activeTab && activeTab.dataset.location === 'browserLocation') {
      renderBrowserLocationWeather();
    }
    // Refresh the bottom-left badge in case browser-location alerts
    // changed (added, removed, or upgraded in severity).
    updateLogoAlert();
  } catch (e) {
    console.error('[BrowserWX] Failed to fetch:', e);
  }
}

function renderBrowserLocationWeather() {
  const scrollArea = document.getElementById('weatherScrollArea');
  if (!browserLocationWeather || !browserLocationWeather.daily || !browserLocationWeather.daily.length) {
    scrollArea.innerHTML = '<div class="loading-spinner">No weather data for this location</div>';
    return;
  }
  const alertsHtml = renderAlertsBanner(browserLocationWeather.alerts, 'browserLocation');
  scrollArea.innerHTML = alertsHtml + browserLocationWeather.daily.map((day, i) =>
    `<div class="weather-day-card" onclick='showBrowserLocationDetail(${i})'>
      <div class="wx-icon">${getWxIcon(day.condition)}</div>
      <div class="wx-info">
        <div class="wx-day">${day.dayName} <span class="wx-date">${day.date}</span></div>
        <div class="wx-desc">${escapeHtml(day.condition)}</div>
      </div>
      <div class="wx-temps">
        <div class="wx-high" style="color:${getTempColor(day.high)}">${day.high}&deg;</div>
        <div class="wx-low" style="color:${getTempColor(day.low)}">${day.low}&deg;</div>
      </div>
    </div>`
  ).join('');
}

function showBrowserLocationDetail(dayIndex) {
  if (!browserLocationWeather) return;
  const day = browserLocationWeather.daily[dayIndex];
  const content = document.getElementById('weatherDetailContent');
  const locName = browserLocationWeather.name || 'Browser Location';
  const lat = currentLocation ? currentLocation.lat : null;
  const lon = currentLocation ? currentLocation.lon : null;
  const radarUrl = (lat && lon) ? buildRadarUrl(lat, lon) : '';
  const windyUrl = (lat && lon) ? buildWindyUrl(lat, lon) : '';
  const windyLat = lat || '';
  const windyLon = lon || '';

  content.innerHTML = `
    <h2><span class="wx-detail-icon">${getWxIcon(day.condition)}</span> ${day.dayName} - ${locName}</h2>
    <p class="wx-detail-subtitle">${day.date}</p>
    ${renderAlertsBanner(browserLocationWeather.alerts, 'browserLocation')}
    <div class="wx-detail-split">
      <div class="wx-detail-data">
        <div class="wx-detail-grid">
          <div class="wx-detail-stat">
            <div class="label">High</div>
            <div class="value temp-high" style="color:${getTempColor(day.high)}">${day.high}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Low</div>
            <div class="value temp-low" style="color:${getTempColor(day.low)}">${day.low}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Dew Point</div>
            <div class="value">${day.dewPoint}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Wind</div>
            <div class="value">${day.wind}</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Cloud Cover</div>
            <div class="value">${day.cloudCover}%</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Precip Chance</div>
            <div class="value">${day.precipChance}%</div>
          </div>
        </div>
        <div class="wx-forecast-text">
          <strong>Forecast:</strong> ${escapeHtml(day.forecastText)}
        </div>
      </div>
      <div class="wx-detail-chart-side">
        <div class="chart-container">
          <canvas id="wxTrendChart"></canvas>
        </div>
      </div>
    </div>
    ${radarUrl ? `<div class="wx-detail-radar-bottom">
      <iframe src="${radarUrl}" style="width:100%;height:100%;border:none;border-radius:8px;" allowfullscreen></iframe>
    </div>` : ''}
    ${windyUrl ? `<div class="wx-detail-section-title">
      Windy <span class="windy-current">Satellite Map</span>
      <div class="windy-toggle-group">
        <button class="windy-toggle-btn active" onclick="switchWindyOverlay('satellite', this)">Satellite</button>
        <button class="windy-toggle-btn" onclick="switchWindyOverlay('cape', this)">CAPE Index</button>
      </div>
    </div>
    <div class="wx-detail-windy-bottom">
      <iframe src="${windyUrl}" data-lat="${windyLat}" data-lon="${windyLon}" style="width:100%;height:100%;border:none;border-radius:8px;" allowfullscreen></iframe>
    </div>` : ''}
  `;

  showPanel('weatherDetailPanel');

  // Render trend chart
  setTimeout(() => renderWeatherChart(browserLocationWeather), 100);
}

// Init location
(function initLocation() {
  const saved = localStorage.getItem('mnv-location-override');
  if (saved) {
    try {
      currentLocation = JSON.parse(saved);
      document.getElementById('browserLocation').textContent = `📍 ${currentLocation.city}, ${currentLocation.state}`;
      updateBrowserLocationTab();
      fetchBrowserLocationWeather();
    } catch (e) {
      fetchBrowserLocationAuto();
    }
  } else {
    fetchBrowserLocationAuto();
  }
})();

// --- Current Conditions ---
function updateCurrentTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/New_York'
  });
  document.getElementById('conditionsTime').textContent = timeStr;
}

async function fetchCurrentWeather() {
  let lat, lon;

  // Use override location if set (non-auto)
  if (currentLocation && !currentLocation.auto) {
    lat = currentLocation.lat;
    lon = currentLocation.lon;
  } else {
    // Default to Chantilly, VA if geolocation fails
    lat = 38.8942;
    lon = -77.4311;
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      lat = pos.coords.latitude.toFixed(4);
      lon = pos.coords.longitude.toFixed(4);
    } catch (e) {
      console.log('[CurrentWX] Geolocation unavailable, using default location');
    }
  }

  try {
    const res = await fetch(`/api/current-weather?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (data.temperature != null) {
      // Bottom-right current conditions: use real time of day so we show
      // the moon at night and the sun during the day.
      document.getElementById('conditionsIcon').innerHTML = getWxIcon(data.description, 'auto');
      document.getElementById('conditionsTemp').innerHTML = data.temperature + '&deg;F';
    }
  } catch (e) {
    console.error('[CurrentWX] Failed to fetch:', e);
  }
}

// Update clock every second
setInterval(updateCurrentTime, 1000);
updateCurrentTime();

// Fetch current weather now and every 10 minutes
fetchCurrentWeather();
setInterval(fetchCurrentWeather, 10 * 60 * 1000);

// --- Dow Jones Indicator ---
async function fetchDow() {
  try {
    const res = await fetch('/api/dow');
    const data = await res.json();
    if (data.price) {
      document.getElementById('dowValue').textContent = data.price.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const arrow = data.direction === 'up' ? '\u25B2' : '\u25BC';
      const sign = data.direction === 'up' ? '+' : '';
      const el = document.getElementById('dowChange');
      el.textContent = `${arrow} ${sign}${data.change.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      el.className = 'dow-change ' + data.direction;
    }
  } catch (e) {
    console.error('[Dow] Failed to fetch:', e);
  }
}

fetchDow();
setInterval(fetchDow, 5 * 60 * 1000);

// --- Event Sort ---
let eventSortMode = 'time'; // 'time' or 'sport'

function getSportClass(sport) {
  const s = (sport || '').toLowerCase();
  if (s.includes('baseball') && s.includes('college')) return 'baseball-college';
  if (s.includes('baseball')) return 'baseball';
  if (s.includes('football') && (s.includes('cfb') || s.includes('college'))) return 'football-college';
  if (s.includes('football')) return 'football';
  if (s.includes('basketball') && (s.includes('ncaam') || s.includes('college'))) return 'basketball-college';
  if (s.includes('basketball')) return 'basketball';
  if (s.includes('tennis')) return 'tennis';
  if (s.includes('golf')) return 'golf';
  if (s.includes('sc2') || s.includes('starcraft')) return 'sc2';
  return '';
}

function sportSortKey(sport) {
  const s = (sport || '').toLowerCase();
  if (s.includes('baseball')) return '1-baseball';
  if (s.includes('football')) return '2-football';
  if (s.includes('basketball')) return '3-basketball';
  if (s.includes('tennis')) return '4-tennis';
  if (s.includes('golf')) return '5-golf';
  if (s.includes('sc2')) return '6-sc2';
  return '9-other';
}

// Drop events that started more than 5 hours ago. Events without a parseable
// sortTime are kept (we'd rather show an undated item than silently hide it).
function filterFreshEvents(items) {
  const FIVE_HOURS = 5 * 60 * 60 * 1000;
  const cutoff = Date.now() - FIVE_HOURS;
  return (items || []).filter(item => {
    const t = item && item.sortTime ? new Date(item.sortTime).getTime() : NaN;
    if (!Number.isFinite(t)) return true;
    return t >= cutoff;
  });
}

function sortEvents(items) {
  const sorted = filterFreshEvents(items);
  if (eventSortMode === 'time') {
    sorted.sort((a, b) => (a.sortTime || '').localeCompare(b.sortTime || ''));
  } else {
    sorted.sort((a, b) => {
      const cmp = sportSortKey(a.sport).localeCompare(sportSortKey(b.sport));
      if (cmp !== 0) return cmp;
      return (a.sortTime || '').localeCompare(b.sortTime || '');
    });
  }
  return sorted;
}

function setEventSort(mode) {
  eventSortMode = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`.sort-btn[data-sort="${mode}"]`).forEach(b => b.classList.add('active'));
  if (isSwapped) {
    renderEventsSidebar(cachedScheduleData);
  } else {
    renderTicker(cachedScheduleData);
  }
}

// --- Swap: News <-> Ticker ---
const sportClassFn = getSportClass;

function renderEventsSidebar(items) {
  const scrollArea = document.getElementById('newsScrollArea');
  const sorted = sortEvents(items);
  if (!sorted.length) {
    scrollArea.innerHTML = '<div class="loading-spinner">No events scheduled</div>';
    return;
  }
  scrollArea.innerHTML = sorted.map(item => {
    const { isClickable, clickAttr, watchHint } = buildEventWatch(item);
    const cls = isClickable ? 'event-card event-card-clickable' : 'event-card';
    return `
    <div class="${cls}" ${clickAttr}>
      <div class="event-header">
        <span class="event-sport sport-badge ${sportClassFn(item.sport)}">${renderLogo(item.leagueLogo, 'league-logo')}${escapeHtml(item.sport)}</span>
        ${watchHint}
      </div>
      <div class="event-matchup">${renderMatchup(item, 'team-logo')}</div>
      <div class="event-meta">
        <span>${escapeHtml(item.network || '')}</span>
        <span class="event-time">${escapeHtml(item.time || '')}</span>
      </div>
    </div>`;
  }).join('');
}

async function getAllNewsForTicker() {
  const track = document.getElementById('tickerTrack');
  const total = allNewsCategoriesList.length;
  let loaded = 0;

  // Load all categories in parallel
  const fetchPromises = allNewsCategoriesList.map(async (cat) => {
    if (!allNewsData[cat]) {
      try {
        const res = await fetch('/api/news/' + encodeURIComponent(cat));
        allNewsData[cat] = await res.json();
      } catch (e) { /* skip */ }
    }
    loaded++;
    track.innerHTML = `<span class="ticker-loading">Loading news feeds... (${loaded}/${total})</span>`;
  });

  await Promise.all(fetchPromises);

  // Combine all categories into single array
  const allArticles = [];
  for (const cat of allNewsCategoriesList) {
    if (allNewsData[cat]) {
      allArticles.push(...allNewsData[cat].map(a => ({ ...a, category: cat })));
    }
  }
  // Sort by pubDate descending
  allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return allArticles;
}

function renderNewsTicker(articles) {
  const track = document.getElementById('tickerTrack');
  if (!articles || !articles.length) {
    track.innerHTML = '<span class="ticker-loading">No articles</span>';
    return;
  }

  const itemsHtml = articles.map(a => {
    const timeAgo = getTimeAgo(a.pubDate);
    // Mirror the left-panel news cards: clicking opens the bottom-left
    // article popup (#newsPopup) via showNewsDetail(article). That popup
    // shows source / title / snippet / "Read Full Article" — clicking
    // that link then opens the external popup, same as the sidebar flow.
    // We serialize the whole article into the onclick handler exactly
    // like renderNewsCards() does.
    const hasLink = !!(a && (a.link || '').trim() && a.link !== '#');
    const cls = hasLink ? 'ticker-news-item ticker-news-item-clickable' : 'ticker-news-item';
    const payload = JSON.stringify(a).replace(/"/g, '&quot;');
    const clickAttr = hasLink ? `onclick="showNewsDetail(${payload})"` : '';
    return `
      <div class="${cls}" ${clickAttr}>
        <span class="news-source-badge">${renderFavicon(a.favicon)}${escapeHtml(a.source)}</span>
        <span class="news-headline">${escapeHtml(a.title)}</span>
        <span class="news-time">${timeAgo}</span>
      </div>
    `;
  }).join('');

  // Duplicate for seamless scrolling
  track.innerHTML = itemsHtml + itemsHtml;

  requestAnimationFrame(() => {
    const totalWidth = track.scrollWidth / 2;
    const duration = Math.max(60, totalWidth / 60);
    track.style.animationDuration = duration + 's';
  });
}

async function applySwap() {
  const btn = document.getElementById('swapToggle');
  const sidebarHeader = document.querySelector('#newsSidebar .sidebar-header h3');
  const tabsContainer = document.getElementById('newsCategoryTabs');
  const scrollArea = document.getElementById('newsScrollArea');
  const track = document.getElementById('tickerTrack');

  const sortControls = document.getElementById('eventSortControls');

  if (isSwapped) {
    btn.classList.add('swapped');
    sidebarHeader.innerHTML = '<svg class="sidebar-logo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 4v6l4 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> EVENTS';
    tabsContainer.style.display = 'none';
    sortControls.style.display = '';

    // Show loading states in both areas
    scrollArea.innerHTML = '<div class="loading-spinner">Loading events...</div>';
    track.innerHTML = '<span class="ticker-loading">Loading news feeds...</span>';

    // Fetch events if not cached
    if (!cachedScheduleData.length) {
      try {
        const res = await fetch('/api/schedule');
        cachedScheduleData = await res.json();
        document.getElementById('statSports').textContent = cachedScheduleData.length;
      } catch (e) {
        try {
          const sc2Res = await fetch('/api/sc2events');
          const sc2 = await sc2Res.json();
          cachedScheduleData = sc2.map(ev => ({
            sport: 'SC2', matchup: ev.name, network: 'Online', time: ev.time, link: ev.link
          }));
        } catch (e2) { /* empty */ }
      }
    }

    // Render events in sidebar
    renderEventsSidebar(cachedScheduleData);

    // Fetch ALL news categories, then render in ticker
    const allArticles = await getAllNewsForTicker();
    renderNewsTicker(allArticles);
  } else {
    btn.classList.remove('swapped');
    sidebarHeader.innerHTML = '<svg class="sidebar-logo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="4" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg> NEWS';
    tabsContainer.style.display = '';
    sortControls.style.display = 'none';

    // Show loading states
    scrollArea.innerHTML = '<div class="loading-spinner">Loading news...</div>';
    track.innerHTML = '<span class="ticker-loading">Loading events...</span>';

    // Restore news in sidebar
    const activeTab = document.querySelector('#newsCategoryTabs .tab-btn.active');
    const activeCategory = activeTab ? activeTab.dataset.category : 'Tech';
    await loadNewsCategory(activeCategory);

    // Fetch events if not cached, then restore in ticker
    if (!cachedScheduleData.length) {
      try {
        const res = await fetch('/api/schedule');
        cachedScheduleData = await res.json();
        document.getElementById('statSports').textContent = cachedScheduleData.length;
      } catch (e) { /* empty */ }
    }
    renderTicker(cachedScheduleData);
  }
}

document.getElementById('swapToggle').addEventListener('click', async () => {
  const btn = document.getElementById('swapToggle');
  btn.disabled = true;
  isSwapped = !isSwapped;
  localStorage.setItem('mnv-swapped', isSwapped ? '1' : '0');
  // News-swap and weather-swap both want to own the bottom ticker; only
  // one can be active at a time. Force-disable the other if it's on.
  if (isSwapped && isWeatherSwapped) {
    isWeatherSwapped = false;
    localStorage.setItem('mnv-weather-swapped', '0');
    await applyWeatherSwap();
  }
  await applySwap();
  btn.disabled = false;
});

// =====================================================================
// Weather <-> Events swap (center/weather sidebar variant).
// Mirrors the News<->Events swap on the left, but for the weather sidebar:
//   isWeatherSwapped=false  ->  weather sidebar shows forecast, ticker
//                               shows sports events (default).
//   isWeatherSwapped=true   ->  weather sidebar shows EVENTS list, ticker
//                               shows the active location's forecast.
// Mutual exclusion with isSwapped (news swap) is enforced in both
// button handlers — they both want to own the ticker.
// =====================================================================
let isWeatherSwapped = false;

// Render the active location's daily forecast in the bottom ticker.
// Items are clickable — each one opens the same detail panel that the
// sidebar weather-day cards open, so the user gets identical behavior
// regardless of where weather is currently displayed. Pulls from
// browserLocationWeather for the Browser Location tab (a separate
// store from weatherData[]).
function renderWeatherInTicker(locationKey) {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  // Resolve which forecast source to render and which detail handler to
  // wire onclick to. Browser Location lives in its own variable.
  let daily, onClickFor;
  if (locationKey === 'browserLocation') {
    if (!browserLocationWeather || !browserLocationWeather.daily?.length) {
      track.innerHTML = '<span class="ticker-loading">Loading weather...</span>';
      return;
    }
    daily = browserLocationWeather.daily;
    onClickFor = (i) => `showBrowserLocationDetail(${i})`;
  } else {
    if (!weatherData || !weatherData[locationKey] || !weatherData[locationKey].daily?.length) {
      track.innerHTML = '<span class="ticker-loading">Loading weather...</span>';
      return;
    }
    daily = weatherData[locationKey].daily;
    onClickFor = (i) => `showWeatherDetail('${locationKey}', ${i})`;
  }

  const itemsHtml = daily.map((day, i) => {
    return `
      <div class="ticker-item ticker-wx-item ticker-wx-item-clickable" onclick="${onClickFor(i)}">
        <span class="ticker-wx-icon">${getWxIcon(day.condition)}</span>
        <span class="ticker-wx-day">${escapeHtml(day.dayName)} <span class="ticker-wx-date">${escapeHtml(day.date)}</span></span>
        <span class="ticker-wx-cond">${escapeHtml(day.condition)}</span>
        <span class="ticker-wx-temps">
          <span class="ticker-wx-high" style="color:${getTempColor(day.high)}">${day.high}&deg;</span>
          /
          <span class="ticker-wx-low" style="color:${getTempColor(day.low)}">${day.low}&deg;</span>
        </span>
      </div>
    `;
  }).join('');
  // Duplicated for seamless scroll. Both copies carry the same onclick
  // (clicking either resolves to the same dayIndex).
  track.innerHTML = itemsHtml + itemsHtml;
  requestAnimationFrame(() => {
    const totalWidth = track.scrollWidth / 2;
    if (!totalWidth) return;
    const duration = Math.max(60, totalWidth / 60);
    track.style.animationDuration = duration + 's';
  });
}

// Build the location selector that sits above the MNV logo in the ticker
// while weather-swap is active. Rendered as a single hamburger button
// that opens a dropdown of the three locations; this keeps the ticker
// chrome compact while still surfacing every option. Clicking an option
// programmatically clicks the corresponding sidebar source tab so the
// existing geolocation / render pipeline runs without duplication.
function buildTickerWeatherLocations() {
  const container = document.getElementById('tickerWeatherLocations');
  if (!container) return;
  const sourceTabs = Array.from(document.querySelectorAll('#weatherLocationTabs .tab-btn'));
  const active = sourceTabs.find(t => t.classList.contains('active'));
  const activeLabel = active ? active.textContent.trim() : 'Location';

  container.innerHTML = `
    <button class="ticker-wx-loc-toggle" aria-label="Choose weather location" aria-expanded="false" title="Choose weather location">
      <span class="hamburger-bars" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="ticker-wx-loc-current">${escapeHtml(activeLabel)}</span>
    </button>
    <div class="ticker-wx-loc-menu" role="menu" hidden></div>
  `;

  const toggleBtn = container.querySelector('.ticker-wx-loc-toggle');
  const menuEl = container.querySelector('.ticker-wx-loc-menu');

  // Populate dropdown options from the source tabs.
  sourceTabs.forEach(src => {
    const opt = document.createElement('button');
    opt.className = 'ticker-wx-loc-option' + (src.classList.contains('active') ? ' active' : '');
    opt.dataset.location = src.dataset.location;
    opt.setAttribute('role', 'menuitem');
    opt.textContent = src.textContent;
    opt.addEventListener('click', () => {
      // Delegate to the source tab (handles geolocation, render branches).
      src.click();
      closeTickerLocMenu();
      syncTickerLocations();
    });
    menuEl.appendChild(opt);
  });

  // Toggle dropdown.
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menuEl.hidden;
    if (isOpen) {
      closeTickerLocMenu();
    } else {
      openTickerLocMenu();
    }
  });

  // Tap-outside-to-close. Re-installs every time the menu is built
  // (cheap; the listener no-ops when the menu is already closed).
  document.addEventListener('click', (e) => {
    if (menuEl.hidden) return;
    if (container.contains(e.target)) return;
    closeTickerLocMenu();
  });
}

function openTickerLocMenu() {
  const container = document.getElementById('tickerWeatherLocations');
  if (!container) return;
  const menuEl = container.querySelector('.ticker-wx-loc-menu');
  const toggleBtn = container.querySelector('.ticker-wx-loc-toggle');
  if (!menuEl || !toggleBtn) return;
  menuEl.hidden = false;
  toggleBtn.setAttribute('aria-expanded', 'true');
  toggleBtn.classList.add('open');
}

function closeTickerLocMenu() {
  const container = document.getElementById('tickerWeatherLocations');
  if (!container) return;
  const menuEl = container.querySelector('.ticker-wx-loc-menu');
  const toggleBtn = container.querySelector('.ticker-wx-loc-toggle');
  if (!menuEl || !toggleBtn) return;
  menuEl.hidden = true;
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.classList.remove('open');
}

function syncTickerLocations() {
  const container = document.getElementById('tickerWeatherLocations');
  if (!container) return;
  const active = document.querySelector('#weatherLocationTabs .tab-btn.active');
  const activeLoc = active ? active.dataset.location : null;
  const activeLabel = active ? active.textContent.trim() : 'Location';

  // Update the visible label on the hamburger button.
  const currentEl = container.querySelector('.ticker-wx-loc-current');
  if (currentEl) currentEl.textContent = activeLabel;

  // Mirror active state into the dropdown options.
  container.querySelectorAll('.ticker-wx-loc-option').forEach(b => {
    b.classList.toggle('active', b.dataset.location === activeLoc);
  });
}

async function applyWeatherSwap() {
  const btn = document.getElementById('weatherSwapToggle');
  const titleEl = document.getElementById('weatherSidebarTitle');
  const locationTabs = document.getElementById('weatherLocationTabs');
  const scrollArea = document.getElementById('weatherScrollArea');
  const track = document.getElementById('tickerTrack');
  const tickerLocs = document.getElementById('tickerWeatherLocations');

  if (isWeatherSwapped) {
    btn.classList.add('swapped');
    titleEl.innerHTML = '<svg class="sidebar-logo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 4v6l4 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> EVENTS';
    // Hide location tabs in events mode (no use for them); show event sort.
    locationTabs.style.display = 'none';

    scrollArea.innerHTML = '<div class="loading-spinner">Loading events...</div>';
    track.innerHTML = '<span class="ticker-loading">Loading weather...</span>';

    // Ensure schedule data is loaded
    if (!cachedScheduleData.length) {
      try {
        const res = await fetch('/api/schedule');
        cachedScheduleData = await res.json();
        document.getElementById('statSports').textContent = cachedScheduleData.length;
      } catch (e) { /* ignore */ }
    }

    // The events list is rendered into the weather sidebar's scroll area.
    // We delegate to a small helper that reuses sortEvents() and the same
    // event-card markup as renderEventsSidebar().
    renderEventsIntoArea(cachedScheduleData, scrollArea);

    // Put the active weather location's forecast into the ticker, and
    // surface a location selector in the ticker-logo area so the user
    // can switch among Chantilly / Cincinnati / Browser Location while
    // the original sidebar tabs are hidden behind the events view.
    const activeTab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    const activeLoc = activeTab ? activeTab.dataset.location : 'chantilly';
    renderWeatherInTicker(activeLoc);
    buildTickerWeatherLocations();
    if (tickerLocs) tickerLocs.hidden = false;
    document.body.classList.add('weather-swapped');
  } else {
    btn.classList.remove('swapped');
    titleEl.innerHTML = '<svg class="sidebar-logo" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="8" y1="2" x2="8" y2="0.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="8" y1="14" x2="8" y2="15.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="2" y1="8" x2="0.5" y2="8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="14" y1="8" x2="15.5" y2="8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="3.8" y1="3.8" x2="2.7" y2="2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="12.2" y1="12.2" x2="13.3" y2="13.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="12.2" y1="3.8" x2="13.3" y2="2.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M12 14c0-2 1.5-3.5 3.5-3.5S19 12 19 14c0 1.5-1.2 2.5-2.5 2.5h-5c-1.5 0-2.5-1-2.5-2.5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> WEATHER';
    locationTabs.style.display = '';

    // Tear down the ticker location selector and restore standard layout.
    if (tickerLocs) {
      tickerLocs.hidden = true;
      tickerLocs.innerHTML = '';
    }
    document.body.classList.remove('weather-swapped');

    // Restore weather in the sidebar and events in the ticker.
    const activeTab = document.querySelector('#weatherLocationTabs .tab-btn.active');
    const activeLoc = activeTab ? activeTab.dataset.location : 'chantilly';
    renderWeatherSidebar(activeLoc);
    renderTicker(cachedScheduleData);
  }
}

// Render events into a given scroll-area element (factored out of
// renderEventsSidebar so applyWeatherSwap can target a different DOM node
// while reusing the same card markup).
function renderEventsIntoArea(items, areaEl) {
  if (!areaEl) return;
  const sorted = sortEvents(items);
  if (!sorted.length) {
    areaEl.innerHTML = '<div class="loading-spinner">No events scheduled</div>';
    return;
  }
  areaEl.innerHTML = sorted.map(item => {
    const { isClickable, clickAttr, watchHint } = buildEventWatch(item);
    const cls = isClickable ? 'event-card event-card-clickable' : 'event-card';
    return `
    <div class="${cls}" ${clickAttr}>
      <div class="event-header">
        <span class="event-sport sport-badge ${getSportClass(item.sport)}">${renderLogo(item.leagueLogo, 'league-logo')}${escapeHtml(item.sport)}</span>
        ${watchHint}
      </div>
      <div class="event-matchup">${renderMatchup(item, 'team-logo')}</div>
      <div class="event-meta">
        <span>${escapeHtml(item.network || '')}</span>
        <span class="event-time">${escapeHtml(item.time || '')}</span>
      </div>
    </div>`;
  }).join('');
}

document.getElementById('weatherSwapToggle').addEventListener('click', async () => {
  const btn = document.getElementById('weatherSwapToggle');
  btn.disabled = true;
  isWeatherSwapped = !isWeatherSwapped;
  localStorage.setItem('mnv-weather-swapped', isWeatherSwapped ? '1' : '0');
  // Mutual exclusion with the news swap (they both want the ticker).
  if (isWeatherSwapped && isSwapped) {
    isSwapped = false;
    localStorage.setItem('mnv-swapped', '0');
    await applySwap();
  }
  await applyWeatherSwap();
  btn.disabled = false;
});

// =====================================================================
// Auto-scroll for the weather sidebar. Behavior:
//   • Default (weather visible): scrolls through the forecast cards and
//     cycles the active location tab at the bottom.
//   • Swapped (events visible): scrolls through the events list and
//     cycles the event sort mode (time/sport) at the bottom.
// Parallel to the news-side auto-scroll; uses its own RAF id and state
// so the two can run independently.
// =====================================================================
let weatherAutoScrollRafId = null;
let weatherAutoScrollLastTs = 0;
let weatherAutoScrollAcc = 0;
let weatherAutoScrollPaused = false;

function cycleWeatherPanel() {
  if (isWeatherSwapped) {
    // Events mode in the weather sidebar: toggle sort.
    const next = eventSortMode === 'time' ? 'sport' : 'time';
    setEventSort(next);
    // The above re-renders only the news sidebar (#newsScrollArea) when
    // isSwapped is true; we need to refresh OUR area regardless.
    const area = document.getElementById('weatherScrollArea');
    renderEventsIntoArea(cachedScheduleData, area);
  } else {
    // Weather mode: advance to the next location tab.
    const tabs = Array.from(document.querySelectorAll('#weatherLocationTabs .tab-btn'));
    if (!tabs.length) return;
    const currentIdx = tabs.findIndex(t => t.classList.contains('active'));
    const nextIdx = (currentIdx + 1) % tabs.length;
    tabs[currentIdx]?.classList.remove('active');
    tabs[nextIdx].classList.add('active');
    const loc = tabs[nextIdx].dataset.location;
    if (loc === 'browserLocation') {
      // The browser-location tab has its own click handler that does the
      // geolocation/fetch work; trigger it instead of calling render.
      tabs[nextIdx].click();
    } else {
      renderWeatherSidebar(loc);
    }
  }
}

function weatherAutoScrollStep(ts) {
  if (!weatherAutoScrollRafId) return;
  if (!weatherAutoScrollLastTs) weatherAutoScrollLastTs = ts;
  const dt = ts - weatherAutoScrollLastTs;
  weatherAutoScrollLastTs = ts;

  if (!weatherAutoScrollPaused) {
    weatherAutoScrollAcc += (AUTO_SCROLL_PX_PER_SEC * dt) / 1000;
    const area = document.getElementById('weatherScrollArea');
    if (area) {
      const maxScroll = area.scrollHeight - area.clientHeight;
      if (maxScroll <= 0) {
        weatherAutoScrollPaused = true;
        setTimeout(() => {
          cycleWeatherPanel();
          weatherAutoScrollAcc = 0;
          setTimeout(() => { weatherAutoScrollPaused = false; weatherAutoScrollLastTs = 0; }, AUTO_SCROLL_PAUSE_AT_TOP_MS);
        }, AUTO_SCROLL_PAUSE_AT_BOTTOM_MS);
      } else if (weatherAutoScrollAcc >= 1) {
        const delta = Math.floor(weatherAutoScrollAcc);
        weatherAutoScrollAcc -= delta;
        area.scrollTop = Math.min(area.scrollTop + delta, maxScroll);
        if (area.scrollTop >= maxScroll - 1) {
          weatherAutoScrollPaused = true;
          setTimeout(() => {
            cycleWeatherPanel();
            weatherAutoScrollAcc = 0;
            const a = document.getElementById('weatherScrollArea');
            if (a) a.scrollTop = 0;
            setTimeout(() => { weatherAutoScrollPaused = false; weatherAutoScrollLastTs = 0; }, AUTO_SCROLL_PAUSE_AT_TOP_MS);
          }, AUTO_SCROLL_PAUSE_AT_BOTTOM_MS);
        }
      }
    }
  }
  weatherAutoScrollRafId = requestAnimationFrame(weatherAutoScrollStep);
}

function setWeatherAutoScroll(enabled) {
  const btn = document.getElementById('weatherAutoScrollToggle');
  const statusSpan = btn.querySelector('.scroll-status');
  if (enabled) {
    if (!weatherAutoScrollRafId) {
      weatherAutoScrollLastTs = 0;
      weatherAutoScrollAcc = 0;
      weatherAutoScrollPaused = false;
      weatherAutoScrollRafId = requestAnimationFrame(weatherAutoScrollStep);
    }
    statusSpan.textContent = 'ON';
    btn.classList.add('auto-on');
    localStorage.setItem('mnv-weather-auto-scroll', '1');
  } else {
    if (weatherAutoScrollRafId) {
      cancelAnimationFrame(weatherAutoScrollRafId);
      weatherAutoScrollRafId = null;
    }
    statusSpan.textContent = 'OFF';
    btn.classList.remove('auto-on');
    localStorage.setItem('mnv-weather-auto-scroll', '0');
  }
}

document.getElementById('weatherAutoScrollToggle').addEventListener('click', () => {
  setWeatherAutoScroll(!weatherAutoScrollRafId);
});

// --- Init ---
(async function init() {
  // Start all data loads in parallel
  const newsPromise = initNews();
  const weatherPromise = loadWeather();
  const schedulePromise = loadSchedule();

  // Wait for news and schedule before restoring swap state
  await Promise.allSettled([newsPromise, schedulePromise]);

  // Restore swap states. News-swap and weather-swap are mutually
  // exclusive (they both want the ticker); if both saved as on, prefer
  // the more-recently-toggled one — we tiebreak by giving weather
  // priority since the news swap has existed longer.
  const savedNewsSwap    = localStorage.getItem('mnv-swapped') === '1';
  const savedWeatherSwap = localStorage.getItem('mnv-weather-swapped') === '1';
  if (savedWeatherSwap) {
    isWeatherSwapped = true;
    await applyWeatherSwap();
  } else if (savedNewsSwap) {
    isSwapped = true;
    await applySwap();
  }

  // Restore the weather sidebar's auto-scroll setting independently.
  if (localStorage.getItem('mnv-weather-auto-scroll') === '1') {
    setWeatherAutoScroll(true);
  }
})();
