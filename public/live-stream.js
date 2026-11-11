/* Live TV feeds, played as just the video filling the main panel.
 * Used by the main page, /wx and /biznews. Load after app.js; the page provides the
 * #wxStreamPanel markup and a card calling wxShowStream('<key>').
 *
 * Pop-out (wxPopOutStream, /wx): the video moves to a floating
 * picture-in-picture player and keeps playing while the main panel is
 * free for other views. Closing the player stops the feed; its "back to
 * tab" button returns the feed to the main panel. Browsers without
 * picture-in-picture get the feed in a separate window (/wx/live), which
 * also loads this file, with no panels.
 */
(function () {
  // Live weather feeds, keyed by the card's onclick name. `id` is the
  // famelack channel id (the last segment of its famelack.com URL); the
  // server resolves it to the channel's direct HLS stream URLs.
  const STREAMS = {
    weatherChannel: { id: '0zAq6komI7uPHX', title: 'The Weather Channel' },
    weatherNation:  { id: 'rsgBN1CiczuZvL', title: 'WeatherNation' },
    // /biznews
    bloomberg:      { id: 'TGIxs2mxFIlLmz', title: 'Bloomberg TV' },
    foxBusiness:    { id: 'eNOYZvW4v10TNt', title: 'Fox Business' },
    // weatherCams: TBD — source not chosen yet; its card is disabled.
  };

  // hls.js plays HLS in browsers without native support (Chrome, Firefox,
  // Edge). Loaded on first use only, pinned to an exact version.
  const HLS_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';

  const PANEL = 'wxStreamPanel';
  const $ = (id) => document.getElementById(id);

  let hls = null;          // active hls.js instance, if any
  let playToken = 0;       // bumps on every start/stop to cancel stale loads
  let hlsLoading = null;   // promise for the hls.js script
  let currentKey = null;   // feed playing (or loading), if any
  let popped = false;      // playing in the picture-in-picture player
  let closingPip = false;  // we're closing the player ourselves

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

  // Restart without closing the picture-in-picture player: replace the
  // player but leave the video element (and so the floating window) alone.
  function softStop() {
    playToken++;
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
  }

  function stopStream() {
    playToken++;
    currentKey = null;
    const video = $('wxStreamVideo');
    if (video && document.pictureInPictureElement === video) {
      closingPip = true;
      document.exitPictureInPicture().catch(() => {});
    }
    setPopped(false);
    if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
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

  // The Weather Channel's CDN often fails requests for the newest few
  // segments of the live stream (they load fine seconds later). So: start
  // further back from the live edge than hls.js's default of 3 segments,
  // and keep retrying a failed segment, backing off, rather than giving up
  // after a few quick attempts.
  const HLS_CONFIG = {
    lowLatencyMode: false,
    liveSyncDurationCount: 5,          // ~30 s behind live
    liveMaxLatencyDurationCount: 15,   // jump forward if it falls this far behind
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10000,
        maxLoadTimeMs: 30000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 10, retryDelayMs: 1000, maxRetryDelayMs: 8000, backoff: 'exponential' },
      },
    },
  };

  // Once playing, errors are recovered from rather than ending playback:
  // a fatal network error resumes loading, a media error resets the
  // decoder. Too many in a row, or a stall that doesn't clear, reconnects
  // to the feed from scratch. Only a feed that can't be restarted at all
  // shows as unavailable.
  const MAX_RECOVERIES = 4;               // per RECOVERY_WINDOW_MS, then reconnect
  const RECOVERY_WINDOW_MS = 60 * 1000;
  const STALL_RECOVER_MS = 15 * 1000;     // no progress this long: resume loading
  const STALL_RECONNECT_MS = 40 * 1000;   // no progress this long: reconnect
  let recoveries = [];

  function recover(Hls, data, token) {
    if (token !== playToken || !hls) return;
    const now = Date.now();
    recoveries = recoveries.filter(t => now - t < RECOVERY_WINDOW_MS);
    recoveries.push(now);
    console.warn('[LiveStream] recovering from', data.details || data.type);
    if (recoveries.length > MAX_RECOVERIES) { reconnect(token); return; }
    setStatus('Reconnecting…');
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
    else hls.startLoad();
  }

  let reconnecting = false;
  function reconnect(token) {
    if (token !== playToken || !currentKey || reconnecting) return;
    reconnecting = true;
    recoveries = [];
    console.warn('[LiveStream] reconnecting', currentKey);
    window.wxShowStream(currentKey, { reconnect: true }).finally(() => { reconnecting = false; });
  }

  // Stall watchdog: playing (not paused by the viewer) but not advancing.
  let lastProgressAt = 0;
  let lastTime = -1;
  setInterval(() => {
    const video = $('wxStreamVideo');
    if (!video || !currentKey || !hls || video.paused) { lastProgressAt = Date.now(); lastTime = -1; return; }
    if (video.currentTime !== lastTime) { lastTime = video.currentTime; lastProgressAt = Date.now(); return; }
    const stuck = Date.now() - lastProgressAt;
    const token = playToken;
    if (stuck > STALL_RECONNECT_MS) { lastProgressAt = Date.now(); reconnect(token); }
    else if (stuck > STALL_RECOVER_MS && window.Hls) {
      setStatus('Reconnecting…');
      try { hls.startLoad(); } catch (_) {}
    }
  }, 5000);

  function playUrl(video, url, Hls, token) {
    return new Promise((resolve, reject) => {
      let timer = null;
      let started = false;
      const done = (err) => {
        clearTimeout(timer);
        video.removeEventListener('playing', onPlaying);
        video.onerror = null;
        if (err) {
          if (hls) { try { hls.destroy(); } catch (_) {} hls = null; }
          reject(err);
        } else {
          started = true;
          resolve();
        }
      };
      const onPlaying = () => done();
      video.addEventListener('playing', onPlaying);
      timer = setTimeout(() => done(new Error('timed out starting')), START_TIMEOUT_MS);

      if (Hls && Hls.isSupported()) {
        hls = new Hls(HLS_CONFIG);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data || !data.fatal || token !== playToken) return;
          // Before playback starts, fail so the next stream URL is tried;
          // after, recover instead of stopping.
          if (started) recover(Hls, data, token);
          else done(new Error(data.details || 'stream error'));
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari, iOS). After it starts, an error reconnects.
        video.onerror = () => {
          if (started) reconnect(token);
          else done(new Error('native playback error'));
        };
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

  // opts.reconnect: restarting a feed that dropped. It stays in the
  // picture-in-picture player if it was there, and in the main panel
  // otherwise, without taking the main panel back.
  window.wxShowStream = async function (key, opts) {
    const s = STREAMS[key];
    if (!s) return;
    const reconnecting = !!(opts && opts.reconnect);
    const keepPopped = reconnecting && popped;
    if (keepPopped) softStop(); else stopStream();
    const token = playToken;
    const video = $('wxStreamVideo');
    if (!video) return;
    currentKey = key;
    recoveries = [];
    video.setAttribute('aria-label', s.title + ' — live');
    if (!window.showPanel) document.title = s.title + ' — Live';   // pop-out window
    if (!keepPopped) {
      document.body.classList.add('wx-streaming');
      if (window.showPanel && !reconnecting) window.showPanel(PANEL);
    }
    setStatus((reconnecting ? 'Reconnecting to ' : 'Loading ') + s.title + '…');

    let streams;
    try {
      const res = await fetch('/api/wx-stream/' + encodeURIComponent(s.id));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      streams = (await res.json()).streams || [];
    } catch (e) {
      if (token === playToken) streamFailed(s.title);
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
        console.warn('[LiveStream] stream failed, trying next:', e.message);
      }
    }
    if (token === playToken) streamFailed(s.title);
  };

  // Nothing is playing: say so, and let the page change panels again.
  function streamFailed(title) {
    if (popped) stopStream();   // don't leave a frozen floating player
    setStatus(title + ' is unavailable right now.');
    document.body.classList.remove('wx-streaming');
  }

  // ── Pop-out ───────────────────────────────────────────────────────
  function setPopped(on) {
    popped = on;
    document.body.classList.toggle('wx-stream-popped', on);
  }

  window.wxPopOutStream = async function () {
    const video = $('wxStreamVideo');
    const key = currentKey;
    if (!video || !key) return;
    if (document.pictureInPictureEnabled && !video.disablePictureInPicture && video.readyState >= 1) {
      try {
        await video.requestPictureInPicture();   // 'enterpictureinpicture' does the rest
        return;
      } catch (e) {
        console.warn('[LiveStream] picture-in-picture unavailable, using a window:', e.message);
      }
    }
    // No picture-in-picture: play the feed in its own small window instead.
    const win = window.open('/wx/live?feed=' + encodeURIComponent(key), 'mnvLiveVideo',
      'width=720,height=405,left=60,top=60,resizable=yes,scrollbars=no');
    if (!win) return;   // blocked: keep playing here
    stopStream();
    if (window.mnvLiveStream.onPoppedOut) window.mnvLiveStream.onPoppedOut();
  };

  const videoEl = $('wxStreamVideo');
  if (videoEl) {
    // Playing again after a recovery: clear "Reconnecting…".
    videoEl.addEventListener('playing', () => { if (currentKey) setStatus(''); });
    videoEl.addEventListener('enterpictureinpicture', () => {
      setPopped(true);
      // The main panel is free again; the page shows its own view there.
      document.body.classList.remove('wx-streaming');
      if (window.mnvLiveStream.onPoppedOut) window.mnvLiveStream.onPoppedOut();
    });
    videoEl.addEventListener('leavepictureinpicture', () => {
      if (closingPip) { closingPip = false; return; }   // stopStream closed it
      setPopped(false);
      // Closing the player pauses the video: stop the feed. "Back to tab"
      // leaves it playing: bring it back to the main panel.
      if (videoEl.paused || !currentKey || !window.showPanel) {
        stopStream();
      } else {
        document.body.classList.add('wx-streaming');
        if (window.mnvLiveStream.onPoppedBack) window.mnvLiveStream.onPoppedBack();
        else window.showPanel(PANEL);
      }
    });
  }

  // Leaving the stream panel, by any path, stops playback, so a stream never
  // keeps playing audio behind another view, unless it has been popped out.
  // (The pop-out window has no panels.)
  const baseShowPanel = window.showPanel;
  if (baseShowPanel) {
    window.showPanel = function (panelId) {
      if (panelId !== PANEL && !popped) stopStream();
      return baseShowPanel.apply(this, arguments);
    };
  }

  // /wx replaces this with its own view for the selected location.
  window.wxCloseStream = function () {
    window.showPanel('welcomeScreen');
  };

  // onPoppedOut / onPoppedBack: set by the page (wx.js).
  window.mnvLiveStream = { PANEL, onPoppedOut: null, onPoppedBack: null };

  // Pop-out window (/wx/live?feed=<key>): play the requested feed.
  if (!baseShowPanel) {
    const feed = new URLSearchParams(location.search).get('feed');
    if (feed && STREAMS[feed]) window.wxShowStream(feed);
    else setStatus('Unknown feed.');
  }
})();
