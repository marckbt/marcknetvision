/* MarckNet WX page — weather-focused page.
 *
 * Runs alongside the shared app.js, which provides the weather panel (now
 * in the left column), the location tabs, and the weather cycle in the
 * bottom ticker. app.js skips news and sports events when
 * window.MNV_PAGE === 'wx'.
 *
 * This file adds:
 *   - live weather feeds, played as just the video filling the main panel,
 *   - stopping playback whenever another panel is shown (so a stream never
 *     keeps playing audio behind a different view),
 *   - the Windy radar, kept centered on the selected location tab.
 */
(function () {
  // Live weather feeds, keyed by the card's onclick name. `id` is the
  // famelack channel id (the last segment of its famelack.com URL); the
  // server resolves it to the channel's direct HLS stream URLs.
  const STREAMS = {
    weatherChannel: { id: '0zAq6komI7uPHX', title: 'The Weather Channel' },
    weatherNation:  { id: 'rsgBN1CiczuZvL', title: 'WeatherNation' },
    skyWeather:     { id: 'CkqK0vHvwZKLiX', title: 'Sky Weather' },
    // weatherCams: TBD — source not chosen yet; its card is disabled.
  };

  // hls.js plays HLS in browsers without native support (Chrome, Firefox,
  // Edge). Loaded on first use only, pinned to an exact version.
  const HLS_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';

  const STREAM_PANEL = 'wxStreamPanel';
  const RADAR_PANEL = 'weatherscanPanel';
  const $ = (id) => document.getElementById(id);

  let hls = null;          // active hls.js instance, if any
  let playToken = 0;       // bumps on every start/stop to cancel stale loads
  let hlsLoading = null;   // promise for the hls.js script

  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsLoading) {
      hlsLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HLS_JS_URL;
        s.onload = () => resolve(window.Hls);
        s.onerror = () => { hlsLoading = null; reject(new Error('hls.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return hlsLoading;
  }

  function setStatus(text) {
    const el = $('wxStreamStatus');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function stopStream() {
    playToken++;
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
    const video = $('wxStreamVideo');
    if (video && (video.currentSrc || video.getAttribute('src'))) {
      video.pause();
      video.removeAttribute('src');
      video.load();   // fully release the stream
    }
    setStatus('');
    document.body.classList.remove('wx-streaming');
  }

  // Play one HLS URL. Resolves when playback starts, rejects on a fatal
  // error so the caller can fall back to the channel's next stream.
  const START_TIMEOUT_MS = 20000;   // give up on a stream that never starts

  function playUrl(video, url, Hls, token) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = (err) => {
        clearTimeout(timer);
        video.removeEventListener('playing', onPlaying);
        video.onerror = null;
        if (err) {
          if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
          reject(err);
        } else {
          resolve();
        }
      };
      const onPlaying = () => done();
      video.addEventListener('playing', onPlaying);
      timer = setTimeout(() => done(new Error('timed out starting')), START_TIMEOUT_MS);

      if (Hls && Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data || !data.fatal || token !== playToken) return;
          done(new Error(data.details || 'stream error'));
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari, iOS).
        video.onerror = () => done(new Error('native playback error'));
        video.src = url;
      } else {
        done(new Error('HLS not supported in this browser'));
        return;
      }
      // Muted autoplay is allowed everywhere; controls let the viewer unmute.
      video.muted = true;
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    });
  }

  // Route every panel change through here so leaving the stream panel —
  // by any path (close, a weather day, World, radar…) — stops playback.
  const baseShowPanel = window.showPanel;
  window.showPanel = function (panelId) {
    if (panelId !== STREAM_PANEL) stopStream();
    return baseShowPanel.apply(this, arguments);
  };

  window.wxShowStream = async function (key) {
    const s = STREAMS[key];
    if (!s) return;
    stopStream();
    const token = playToken;
    const video = $('wxStreamVideo');
    if (!video) return;
    video.setAttribute('aria-label', s.title + ' — live');
    document.body.classList.add('wx-streaming');
    window.showPanel(STREAM_PANEL);
    setStatus('Loading ' + s.title + '…');

    let streams;
    try {
      const res = await fetch('/api/wx-stream/' + encodeURIComponent(s.id));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      streams = (await res.json()).streams || [];
    } catch (e) {
      if (token === playToken) setStatus(s.title + ' is unavailable right now.');
      return;
    }

    let Hls = null;
    try { Hls = await loadHlsJs(); } catch (_) { /* fall back to native HLS */ }

    for (const url of streams) {
      if (token !== playToken) return;   // user moved on
      try {
        await playUrl(video, url, Hls, token);
        if (token === playToken) setStatus('');
        return;
      } catch (e) {
        console.warn('[WX] stream failed, trying next:', e.message);
      }
    }
    if (token === playToken) setStatus(s.title + ' is unavailable right now.');
  };

  window.wxCloseStream = function () {
    window.showPanel('welcomeScreen');   // stopStream() runs via the wrapper
  };

  window.wxShowRadar = function () {
    if (typeof showWeatherRadar === 'function') showWeatherRadar();
  };

  // Keep the radar centered on the selected location: if the radar panel is
  // showing when a location tab is clicked, re-center it. app.js's own tab
  // handler runs first (it marks the new tab active), so read the active
  // tab on the next tick.
  function bindRadarFollow() {
    const tabs = $('weatherLocationTabs');
    if (!tabs) return;
    tabs.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-btn')) return;
      setTimeout(() => {
        const radar = $(RADAR_PANEL);
        if (radar && radar.classList.contains('active') && typeof showWeatherRadar === 'function') {
          showWeatherRadar();
        }
      }, 0);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindRadarFollow);
  else bindRadarFollow();
})();
