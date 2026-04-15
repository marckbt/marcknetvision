// ===== MarckNetVision Dashboard App =====

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
    return `<div class="news-card" data-index="${i}" onclick="showNewsDetail(${JSON.stringify(a).replace(/"/g, '&quot;')})">
      <div class="source">${escapeHtml(a.source)}</div>
      <div class="title">${escapeHtml(a.title)}</div>
      <div class="time">${timeAgo}</div>
    </div>`;
  }).join('');
}

function showNewsDetail(article) {
  const popup = document.getElementById('newsPopup');
  const content = document.getElementById('newsPopupContent');
  const timeAgo = getTimeAgo(article.pubDate);
  document.querySelector('.news-chat-title').textContent = article.source || 'Article';
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
      renderWeatherSidebar(activeLoc);
    }
    setupWeatherTabs();
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
      if (loc === 'pivotal') {
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

function getWxIcon(condition) {
  const lower = (condition || '').toLowerCase();

  // Thunderstorms (check before rain/snow)
  if (lower.includes('thundersnow')) return wxIconImg('ThunderSnow.gif');
  if (lower.includes('thunderstorm') || (lower.includes('thunder') && lower.includes('storm'))) return wxIconImg('Thunderstorm.gif');
  if (lower.includes('thunder') || lower.includes('tstm') || lower.includes('lightning')) return wxIconImg('Thunder.gif');

  // Wintry mix / combination precip
  if (lower.includes('wintry mix') || (lower.includes('rain') && lower.includes('snow') && lower.includes('sleet'))) return wxIconImg('Wintry-Mix.gif');
  if (lower.includes('freezing rain') && lower.includes('sleet')) return wxIconImg('Freezing-Rain-Sleet.gif');
  if (lower.includes('freezing rain') || lower.includes('freezing drizzle')) return wxIconImg('Freezing-Rain.gif');
  if ((lower.includes('rain') && lower.includes('snow')) || (lower.includes('snow') && lower.includes('rain'))) return wxIconImg('Rain-Snow.gif');
  if ((lower.includes('snow') && lower.includes('sleet')) || (lower.includes('sleet') && lower.includes('snow'))) return wxIconImg('Snow-Sleet.gif');
  if ((lower.includes('ice') && lower.includes('snow'))) return wxIconImg('Ice-Snow.gif');
  if (lower.includes('sleet') || lower.includes('ice pellet')) return wxIconImg('Sleet.gif');

  // Snow
  if (lower.includes('blowing snow') || lower.includes('blizzard')) return wxIconImg('Blowing-Snow.gif');
  if (lower.includes('heavy snow')) return wxIconImg('Heavy-Snow.gif');
  if (lower.includes('light snow') || lower.includes('flurr') || lower.includes('snow shower')) return wxIconImg('Light-Snow.gif');
  if (lower.includes('snow')) return wxIconImg('Light-Snow.gif');

  // Rain / showers
  if (lower.includes('shower') || lower.includes('scattered') || lower.includes('drizzle') || lower.includes('sprinkle')) return wxIconImg('Shower.gif');
  if (lower.includes('rain')) return wxIconImg('Rain.gif');

  // Cloud cover
  if (lower.includes('mostly cloudy') || lower.includes('considerable cloud')) return wxIconImg('Mostly-Cloudy.gif');
  if (lower.includes('partly cloudy')) return wxIconImg('Partly-Cloudy.gif');
  if (lower.includes('partly sunny') || lower.includes('partly clear')) return wxIconImg('Partly-Clear.gif');
  if (lower.includes('mostly sunny') || lower.includes('mostly clear')) return wxIconImg('Mostly-Clear.gif');
  if (lower.includes('cloudy') || lower.includes('overcast')) return wxIconImg('Cloudy.gif');

  // Clear / sunny
  if (lower.includes('sunny') || lower.includes('fair')) return wxIconImg('Sunny.gif');
  if (lower.includes('clear')) return wxIconImg('Clear.gif');

  // Fog/haze/mist — use Cloudy as closest match
  if (lower.includes('fog') || lower.includes('mist') || lower.includes('haze')) return wxIconImg('Cloudy.gif');

  // Wind — use Partly-Cloudy as fallback
  if (lower.includes('wind')) return wxIconImg('Partly-Cloudy.gif');

  // Default
  return wxIconImg('Partly-Clear.gif');
}

function renderWeatherSidebar(locationKey) {
  const scrollArea = document.getElementById('weatherScrollArea');
  if (!weatherData || !weatherData[locationKey]) {
    scrollArea.innerHTML = '<div class="loading-spinner">No data for this location</div>';
    return;
  }

  const loc = weatherData[locationKey];
  scrollArea.innerHTML = loc.daily.map((day, i) =>
    `<div class="weather-day-card" onclick='showWeatherDetail("${locationKey}", ${i})'>
      <div class="wx-icon">${getWxIcon(day.condition)}</div>
      <div class="wx-info">
        <div class="wx-day">${day.dayName} <span class="wx-date">${day.date}</span></div>
        <div class="wx-desc">${escapeHtml(day.condition)}</div>
      </div>
      <div class="wx-temps">
        <div class="wx-high">${day.high}&deg;</div>
        <div class="wx-low">${day.low}&deg;</div>
      </div>
    </div>`
  ).join('');
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

  content.innerHTML = `
    <h2><span class="wx-detail-icon">${getWxIcon(day.condition)}</span> ${day.dayName} - ${loc.name}</h2>
    <p class="wx-detail-subtitle">${day.date}</p>
    <div class="wx-detail-split">
      <div class="wx-detail-data">
        <div class="wx-detail-grid">
          <div class="wx-detail-stat">
            <div class="label">High</div>
            <div class="value temp-high">${day.high}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Low</div>
            <div class="value temp-low">${day.low}&deg;F</div>
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

function renderTicker(items) {
  const track = document.getElementById('tickerTrack');
  if (!items || !items.length) {
    track.innerHTML = '<span class="ticker-loading">No events scheduled</span>';
    return;
  }

  const sorted = sortEvents(items);
  const itemsHtml = sorted.map(item => `
    <div class="ticker-item">
      <span class="sport-badge ${getSportClass(item.sport)}">${escapeHtml(item.sport)}</span>
      <span class="matchup">${escapeHtml(item.matchup)}</span>
      <span class="network">${escapeHtml(item.network || '')}</span>
      <span class="time">${escapeHtml(item.time || '')}</span>
    </div>
  `).join('');

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

  // Restore saved widths
  ['newsSidebar', 'weatherSidebar'].forEach(id => {
    const saved = localStorage.getItem('mnv-' + id + '-width');
    if (saved) {
      document.getElementById(id).style.width = saved;
    }
  });
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
        // Trigger the refresh
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
        // Trigger full refresh
        (async () => {
          console.log('[FullAutoRefresh] Refreshing all data...');
          try {
            await fetch('/api/refresh', { method: 'POST' });
            allNewsData = {};
            weatherData = null;
            const activeNewsTab = document.querySelector('#newsCategoryTabs .tab-btn.active');
            const activeCategory = activeNewsTab ? activeNewsTab.dataset.category : 'Tech';
            await Promise.all([
              loadNewsCategory(activeCategory, true),
              loadWeather(),
              loadSchedule()
            ]);
          } catch (e) {
            console.error('[FullAutoRefresh] Failed:', e);
          }
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
  scrollArea.innerHTML = browserLocationWeather.daily.map((day, i) =>
    `<div class="weather-day-card" onclick='showBrowserLocationDetail(${i})'>
      <div class="wx-icon">${getWxIcon(day.condition)}</div>
      <div class="wx-info">
        <div class="wx-day">${day.dayName} <span class="wx-date">${day.date}</span></div>
        <div class="wx-desc">${escapeHtml(day.condition)}</div>
      </div>
      <div class="wx-temps">
        <div class="wx-high">${day.high}&deg;</div>
        <div class="wx-low">${day.low}&deg;</div>
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

  content.innerHTML = `
    <h2><span class="wx-detail-icon">${getWxIcon(day.condition)}</span> ${day.dayName} - ${locName}</h2>
    <p class="wx-detail-subtitle">${day.date}</p>
    <div class="wx-detail-split">
      <div class="wx-detail-data">
        <div class="wx-detail-grid">
          <div class="wx-detail-stat">
            <div class="label">High</div>
            <div class="value temp-high">${day.high}&deg;F</div>
          </div>
          <div class="wx-detail-stat">
            <div class="label">Low</div>
            <div class="value temp-low">${day.low}&deg;F</div>
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
      document.getElementById('conditionsIcon').innerHTML = getWxIcon(data.description);
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

function sortEvents(items) {
  const sorted = [...items];
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
  if (!items || !items.length) {
    scrollArea.innerHTML = '<div class="loading-spinner">No events scheduled</div>';
    return;
  }
  const sorted = sortEvents(items);
  scrollArea.innerHTML = sorted.map(item => `
    <div class="event-card">
      <div class="event-header">
        <span class="event-sport sport-badge ${sportClassFn(item.sport)}">${escapeHtml(item.sport)}</span>
      </div>
      <div class="event-matchup">${escapeHtml(item.matchup)}</div>
      <div class="event-meta">
        <span>${escapeHtml(item.network || '')}</span>
        <span class="event-time">${escapeHtml(item.time || '')}</span>
      </div>
    </div>
  `).join('');
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
    return `
      <div class="ticker-news-item">
        <span class="news-source-badge">${escapeHtml(a.source)}</span>
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
  await applySwap();
  btn.disabled = false;
});

// --- Init ---
(async function init() {
  // Start all data loads in parallel
  const newsPromise = initNews();
  const weatherPromise = loadWeather();
  const schedulePromise = loadSchedule();

  // Wait for news and schedule before restoring swap state
  await Promise.allSettled([newsPromise, schedulePromise]);

  if (localStorage.getItem('mnv-swapped') === '1') {
    isSwapped = true;
    await applySwap();
  }
})();
