// ==UserScript==
// @name         YouTube Mobile - Werbefrei und Hintergrund-Wiedergabe
// @namespace    yt-mobile-ipad
// @version      1.2.1
// @description  Entfernt Werbung auf m.youtube.com, SponsorBlock und Wiedergabe bei gesperrtem Bildschirm oder im Hintergrund.
// @match        *://m.youtube.com/*
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @run-at       document-start
// @grant        none
// @sandbox      JavaScript
// @updateURL    https://raw.githubusercontent.com/Kasy999/Youtube/main/youtube-mobile.user.js
// @downloadURL  https://raw.githubusercontent.com/Kasy999/Youtube/main/youtube-mobile.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Die TV-Oberfläche hat ihr eigenes Skript
  if (/^\/tv(\/|$)/.test(location.pathname)) return;

  // ------------------------------------------------------------
  // EINSTELLUNGEN
  // ------------------------------------------------------------
  const CONFIG = {
    adblock: true,                 // Werbung entfernen
    sponsorblock: true,            // Sponsor-Abschnitte überspringen
    sponsorCategories: [
      'sponsor',        // bezahlte Werbung im Video
      'selfpromo',      // Eigenwerbung
      'interaction',    // „Abonniert und liked …"
      // 'intro',
      // 'outro',
      // 'preview',
      // 'music_offtopic',
    ],
    backgroundPlay: true,          // weiterspielen bei gesperrtem Display / im Hintergrund
    lockScreenControls: true,      // Steuerung auf dem Sperrbildschirm
    scaleButton: true,             // Knopf ⤢ zum Anpassen der Größe
    scaleSteps: [1, 0.9, 0.8, 0.7, 0.6, 0.5], // Größenstufen (1 = Original)
  };

  // ------------------------------------------------------------
  // 1) WERBEBLOCKER
  // ------------------------------------------------------------
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const AD_RENDERERS = [
    'adSlotRenderer',
    'promotedSparklesWebRenderer',
    'promotedSparklesTextSearchRenderer',
    'promotedVideoRenderer',
    'compactPromotedVideoRenderer',
    'actionCompanionAdRenderer',
    'adActionInterstitialRenderer',
    'statementBannerRenderer',
    'brandVideoShelfRenderer',
    'brandVideoSingletonRenderer',
  ];

  function isAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    for (const k of AD_RENDERERS) if (k in item) return true;
    // Werbung steckt oft in einem richItemRenderer/itemSectionRenderer-Wrapper
    const inner = item.richItemRenderer && item.richItemRenderer.content;
    if (inner) for (const k of AD_RENDERERS) if (k in inner) return true;
    return false;
  }

  function clean(obj, depth) {
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 50) return obj;
    if (Array.isArray(obj)) {
      for (let i = obj.length - 1; i >= 0; i--) {
        if (isAdItem(obj[i])) obj.splice(i, 1);
        else clean(obj[i], depth + 1);
      }
      return obj;
    }
    for (const k of AD_KEYS) if (k in obj) delete obj[k];
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object') clean(v, depth + 1);
    }
    return obj;
  }

  function looksLikeYouTube(r) {
    return r && typeof r === 'object' && !Array.isArray(r) &&
      ('responseContext' in r || 'playerResponse' in r || 'adPlacements' in r ||
       'playerAds' in r || 'onResponseReceivedActions' in r);
  }

  if (CONFIG.adblock) {
    // a) Antworten, die per JSON.parse gelesen werden
    const origParse = JSON.parse;
    JSON.parse = function () {
      const r = origParse.apply(this, arguments);
      try { if (looksLikeYouTube(r)) clean(r); } catch (e) { /* ignorieren */ }
      return r;
    };

    // b) Antworten, die per fetch(...).json() gelesen werden
    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.apply(this, arguments).then(function (r) {
        try { if (looksLikeYouTube(r)) clean(r); } catch (e) { /* ignorieren */ }
        return r;
      });
    };

    // c) Daten, die beim ersten Laden direkt in der Seite stehen
    ['ytInitialPlayerResponse', 'ytInitialData'].forEach(function (name) {
      let value;
      try {
        Object.defineProperty(window, name, {
          configurable: true,
          get: function () { return value; },
          set: function (v) {
            try { if (v && typeof v === 'object') clean(v); } catch (e) { /* ignorieren */ }
            value = v;
          },
        });
      } catch (e) { /* ignorieren */ }
    });

    // d) Werbeflächen, die trotzdem auftauchen, ausblenden
    const adCss = [
      'ytm-promoted-sparkles-web-renderer',
      'ytm-promoted-video-renderer',
      'ytm-companion-ad-renderer',
      'ytm-companion-slot',
      'ytm-statement-banner-renderer',
      'ytm-brand-video-shelf-renderer',
      'ad-slot-renderer',
      'ytm-ad-slot-renderer',
      'ytm-rich-item-renderer:has(ad-slot-renderer)',
      'ytm-item-section-renderer:has(ytm-promoted-sparkles-web-renderer)',
      '.ytp-ad-overlay-container',
      '#player-ads',
      '#masthead-ad',
    ].join(',\n') + ' { display:none !important; }';

    function injectCss() {
      if (document.getElementById('ytm-ad-css')) return;
      const st = document.createElement('style');
      st.id = 'ytm-ad-css';
      st.textContent = adCss;
      (document.head || document.documentElement).appendChild(st);
    }
    injectCss();
    document.addEventListener('DOMContentLoaded', injectCss);

    // e) Notbremse: Falls doch ein Werbespot läuft, sofort überspringen
    setInterval(function () {
      const player = document.querySelector('#movie_player, .html5-video-player');
      if (!player || !player.classList.contains('ad-showing')) return;
      const skip = document.querySelector(
        '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, button[class*="skip"]');
      if (skip) { try { skip.click(); } catch (e) { /* ignorieren */ } }
      const video = player.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 0) {
        video.muted = true;
        video.currentTime = video.duration;
      }
    }, 300);
  }

  // ------------------------------------------------------------
  // 2) SPONSORBLOCK
  // ------------------------------------------------------------
  let currentId = null;
  let segments = [];

  function getVideoId() {
    const q = location.search.match(/[?&]v=([\w-]{11})/);
    if (q) return q[1];
    const s = location.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return s ? s[1] : null;
  }

  async function loadSegments(id) {
    segments = [];
    try {
      const url = 'https://sponsor.ajay.app/api/skipSegments?videoID=' + id +
        '&categories=' + encodeURIComponent(JSON.stringify(CONFIG.sponsorCategories));
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (id === currentId && Array.isArray(data)) {
        segments = data.map(function (s) { return s.segment; });
      }
    } catch (e) { /* ignorieren */ }
  }

  if (CONFIG.sponsorblock) {
    setInterval(function () {
      const id = getVideoId();
      if (id !== currentId) {
        currentId = id;
        segments = [];
        if (id) loadSegments(id);
      }
      if (!segments.length) return;
      const video = document.querySelector('video');
      if (!video || video.paused) return;
      const t = video.currentTime;
      for (const seg of segments) {
        if (t >= seg[0] && t < seg[1] - 0.3) {
          video.currentTime = seg[1];
          toast('Sponsor-Abschnitt übersprungen');
          break;
        }
      }
    }, 500);
  }

  // ------------------------------------------------------------
  // 3) HINTERGRUND-WIEDERGABE
  // YouTube pausiert das Video, sobald die Seite „unsichtbar" wird
  // (Display aus, App gewechselt). Wir
  //   a) gaukeln YouTube vor, die Seite sei immer sichtbar,
  //   b) schlucken die Meldungen über den Sichtbarkeitswechsel,
  //   c) starten die Wiedergabe neu, falls sie trotzdem
  //      ohne dein Zutun im Hintergrund angehalten wurde.
  // ------------------------------------------------------------
  let reallyHidden = function () { return false; };
  // Zeitpunkt der letzten Pause/Bedienung durch dich (auch Sperrbildschirm)
  let userPausedAt = 0;
  // Zeitpunkt, an dem die Seite wirklich unsichtbar wurde (Display aus)
  let hiddenAt = 0;

  if (CONFIG.backgroundPlay) {
    const proto = Document.prototype;
    const origHidden = Object.getOwnPropertyDescriptor(proto, 'hidden');
    if (origHidden && origHidden.get) {
      reallyHidden = function () { return origHidden.get.call(document); };
    }

    const fake = {
      hidden: false,
      webkitHidden: false,
      visibilityState: 'visible',
      webkitVisibilityState: 'visible',
    };
    Object.keys(fake).forEach(function (prop) {
      try {
        Object.defineProperty(proto, prop, {
          configurable: true,
          get: function () { return fake[prop]; },
        });
      } catch (e) { /* ignorieren */ }
    });
    try {
      proto.hasFocus = function () { return true; };
    } catch (e) { /* ignorieren */ }

    // Sichtbarkeits-Meldungen abfangen, bevor YouTube sie sieht –
    // uns selbst merken wir aber, WANN das Display ausging
    ['visibilitychange', 'webkitvisibilitychange'].forEach(function (type) {
      const note = function (ev) {
        if (reallyHidden()) hiddenAt = Date.now();
        ev.stopImmediatePropagation();
      };
      window.addEventListener(type, note, true);
      document.addEventListener(type, note, true);
    });
    window.addEventListener('pagehide', function () { hiddenAt = Date.now(); }, true);
    window.addEventListener('blur', function (ev) {
      if (ev.target === window) ev.stopImmediatePropagation();
    }, true);

    // Unterscheiden: Hast DU pausiert, oder das System beim Sperren?
    // Das System pausiert direkt beim Ausschalten des Displays. Eine
    // Pause, die später kommt, hast du gedrückt (z. B. Sperrbildschirm).
    const AUTO_PAUSE_WINDOW = 2500;
    ['touchstart', 'click', 'keydown'].forEach(function (type) {
      document.addEventListener(type, function () { userPausedAt = Date.now(); }, true);
    });

    let wasPlaying = false;
    document.addEventListener('play', function (ev) {
      if (ev.target && ev.target.tagName === 'VIDEO') wasPlaying = true;
    }, true);

    document.addEventListener('pause', function (ev) {
      const video = ev.target;
      if (!video || video.tagName !== 'VIDEO') return;
      const now = Date.now();
      const byUser = now - userPausedAt < 1500;
      const ended = video.ended;
      const hidden = reallyHidden();
      const systemPause = hidden && hiddenAt && (now - hiddenAt < AUTO_PAUSE_WINDOW);
      if (byUser || ended || !systemPause) { wasPlaying = false; return; }
      // Pause kam vom System beim Sperren → ein paar Mal neu versuchen
      if (wasPlaying) {
        const pausedAt = now;
        [50, 300, 800, 1500].forEach(function (delay) {
          setTimeout(function () {
            if (!video.paused || video.ended) return;
            if (userPausedAt > pausedAt) return; // inzwischen selbst pausiert
            const p = video.play();
            if (p && p.catch) p.catch(function () {});
          }, delay);
        });
      }
    }, true);

    // Beim Zurückkehren: weiterspielen, falls es unterbrochen wurde
    const resumeIfNeeded = function () {
      if (!wasPlaying) return;
      const video = document.querySelector('video');
      if (video && video.paused && !video.ended) {
        const p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    };
    window.addEventListener('pageshow', resumeIfNeeded);
    window.addEventListener('focus', resumeIfNeeded);
  }

  // ------------------------------------------------------------
  // 4) STEUERUNG AUF DEM SPERRBILDSCHIRM
  // Titel/Kanal anzeigen und Play/Pause/Spulen ermöglichen.
  // Falls die Wiedergabe beim Sperren doch stoppt: hier auf ▶︎.
  // ------------------------------------------------------------
  // Video-Links auf der Seite, die nicht das aktuelle Video sind
  function watchLinks() {
    const cur = getVideoId();
    const out = [];
    const seen = {};
    document.querySelectorAll('a[href*="/watch?v="]').forEach(function (a) {
      const m = a.getAttribute('href').match(/[?&]v=([\w-]{11})/);
      if (!m) return;
      if (a.closest('header, ytm-mobile-topbar-renderer, #ytm-scale-btn')) return;
      out.push({ a: a, id: m[1], current: m[1] === cur, href: a.getAttribute('href') });
      seen[m[1]] = true;
    });
    return out;
  }

  function playlistId() {
    const m = location.search.match(/[?&]list=([\w-]+)/);
    return m ? m[1] : null;
  }

  function goNext() {
    const v = document.querySelector('video');
    const links = watchLinks();
    const list = playlistId();

    // 1) In einer Playlist: das nächste Video der Playlist
    if (list) {
      const inList = links.filter(function (l) { return l.href.indexOf('list=' + list) !== -1; });
      const idx = inList.findIndex(function (l) { return l.current; });
      for (let i = idx + 1; i < inList.length; i++) {
        if (!inList[i].current) { inList[i].a.click(); return; }
      }
    }
    // 2) Sonst: das erste empfohlene Video unter dem Player
    const rec = links.find(function (l) {
      return !l.current && l.a.closest(
        'ytm-single-column-watch-next-results-renderer, ytm-watch-next-secondary-results-renderer, ' +
        'ytm-item-section-renderer, ytm-compact-video-renderer, ytm-video-with-context-renderer');
    }) || links.find(function (l) { return !l.current; });
    if (rec) { rec.a.click(); return; }
    toast('Kein nächstes Video gefunden');
    if (v) v.currentTime = v.duration || v.currentTime;
  }

  function goPrevious() {
    const v = document.querySelector('video');
    // Wie bei Musik-Apps: erst an den Anfang, beim zweiten Druck zurück
    if (v && v.currentTime > 3) { v.currentTime = 0; return; }
    history.back();
  }

  if (CONFIG.lockScreenControls && 'mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const getVideo = function () { return document.querySelector('video'); };

    // Unsere Tasten dürfen nicht von YouTube überschrieben werden.
    // Wichtig: iOS zeigt „10 s spulen" STATT „vorheriges/nächstes",
    // sobald Spul-Tasten gesetzt sind – deshalb blockieren wir diese.
    const OURS = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'];
    const BLOCKED = ['seekbackward', 'seekforward'];
    try {
      const proto = Object.getPrototypeOf(ms);
      const origSet = proto.setActionHandler;
      proto.setActionHandler = function (action, handler) {
        if (BLOCKED.indexOf(action) !== -1) {
          return origSet.call(this, action, null);
        }
        if (OURS.indexOf(action) !== -1 && !(handler && handler.__ytmOurs)) return;
        return origSet.call(this, action, handler);
      };
    } catch (e) { /* ignorieren */ }

    const handlers = {
      play: function () {
        userPausedAt = 0;
        const v = getVideo();
        if (v) { const p = v.play(); if (p && p.catch) p.catch(function () {}); }
      },
      pause: function () {
        userPausedAt = Date.now(); // Pause vom Sperrbildschirm = deine Pause
        const v = getVideo(); if (v) v.pause();
      },
      previoustrack: function () { goPrevious(); },
      nexttrack: function () { goNext(); },
      seekto: function (d) {
        const v = getVideo(); if (v && d && typeof d.seekTime === 'number') v.currentTime = d.seekTime;
      },
    };

    function registerHandlers() {
      Object.keys(handlers).forEach(function (action) {
        const fn = handlers[action];
        fn.__ytmOurs = true;
        try { ms.setActionHandler(action, fn); } catch (e) { /* nicht unterstützt */ }
      });
      BLOCKED.forEach(function (action) {
        try { ms.setActionHandler(action, null); } catch (e) { /* ignorieren */ }
      });
    }
    registerHandlers();

    let lastTitle = '';
    setInterval(function () {
      const v = getVideo();
      if (!v) return;
      // Tasten regelmäßig erneuern, falls sie verloren gehen
      registerHandlers();

      // Fortschrittsbalken auf dem Sperrbildschirm
      try {
        if (ms.setPositionState && isFinite(v.duration) && v.duration > 0) {
          ms.setPositionState({
            duration: v.duration,
            playbackRate: v.playbackRate || 1,
            position: Math.min(v.currentTime, v.duration),
          });
        }
        ms.playbackState = v.paused ? 'paused' : 'playing';
      } catch (e) { /* ignorieren */ }

      if (v.paused || typeof MediaMetadata === 'undefined') return;
      const title = (document.title || '').replace(/\s*-\s*YouTube\s*$/, '');
      if (!title || title === lastTitle) return;
      lastTitle = title;
      const channel = document.querySelector(
        '.slim-owner-channel-name, ytm-slim-owner-renderer .slim-owner-channel-name, [class*="owner"] [class*="name"]');
      const id = getVideoId();
      try {
        ms.metadata = new MediaMetadata({
          title: title,
          artist: channel ? channel.textContent.trim() : 'YouTube',
          artwork: id ? [{ src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', sizes: '480x360', type: 'image/jpeg' }] : [],
        });
      } catch (e) { /* ignorieren */ }
    }, 1000);
  }

  // ------------------------------------------------------------
  // 5) GRÖSSE AN DEN BILDSCHIRM ANPASSEN
  // Die mobile Seite ist für Handys gebaut und wirkt auf dem iPad
  // riesig. Mit dem Knopf ⤢ wählst du eine kleinere Stufe: Die
  // Seite wird dann so aufgebaut, als wäre der Bildschirm breiter,
  // und zeigt mehr Inhalt. Die Stufe wird gemerkt.
  // ------------------------------------------------------------
  let scale = 1;
  try {
    const saved = parseFloat(localStorage.getItem('ytm-scale'));
    if (saved > 0 && saved <= 1) scale = saved;
  } catch (e) { /* ignorieren */ }

  let useZoomFallback = false;

  function screenWidthNow() {
    const landscape = Math.abs(window.orientation || 0) === 90 ||
      (screen.orientation && /landscape/.test(screen.orientation.type));
    return landscape ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  }

  function viewportContent(s) {
    return 'width=device-width, initial-scale=' + s + ', minimum-scale=' + s +
      ', maximum-scale=' + Math.min(5, s * 5) + ', viewport-fit=cover';
  }

  function getViewportMeta() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp && document.head) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      document.head.appendChild(vp);
    }
    return vp;
  }

  function applyScale() {
    const vp = getViewportMeta();
    const root = document.documentElement;
    if (useZoomFallback) {
      // Ausweichweg: Seite per CSS verkleinern
      if (vp && vp.content !== viewportContent(1)) vp.content = viewportContent(1);
      root.style.zoom = scale === 1 ? '' : String(scale);
      return;
    }
    root.style.zoom = '';
    if (vp && vp.content !== viewportContent(scale)) vp.content = viewportContent(scale);
  }

  // Prüfen, ob der Browser die Viewport-Änderung umgesetzt hat
  function verifyScale() {
    if (useZoomFallback || scale === 1) return;
    const expected = screenWidthNow() / scale;
    if (window.innerWidth < expected * 0.85) {
      useZoomFallback = true;
      applyScale();
    }
  }

  function setScale(s) {
    scale = s;
    try { localStorage.setItem('ytm-scale', String(s)); } catch (e) { /* ignorieren */ }
    applyScale();
    setTimeout(verifyScale, 400);
    toast('Größe: ' + Math.round(s * 100) + ' %');
  }

  function nextScale() {
    const steps = CONFIG.scaleSteps;
    let i = steps.indexOf(scale);
    if (i === -1) i = 0;
    setScale(steps[(i + 1) % steps.length]);
  }

  // Knopf: unten rechts, verblasst nach kurzer Zeit
  let scaleBtn = null;
  let fadeTimer = null;
  function brightenButton() {
    if (!scaleBtn) return;
    scaleBtn.style.opacity = '0.95';
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () { scaleBtn.style.opacity = '0.35'; }, 2500);
  }

  function buildScaleButton() {
    if (!CONFIG.scaleButton) return;
    if (!scaleBtn) {
      scaleBtn = document.createElement('div');
      scaleBtn.id = 'ytm-scale-btn';
      scaleBtn.textContent = '⤢';
      scaleBtn.style.cssText = [
        'position:fixed', 'right:calc(14px + env(safe-area-inset-right))',
        'bottom:calc(110px + env(safe-area-inset-bottom))', 'z-index:2147483647',
        'width:48px', 'height:48px', 'border-radius:24px',
        'background:rgba(0,0,0,0.75)', 'color:#fff', 'font-size:24px',
        'border:2px solid rgba(255,255,255,0.7)', 'box-shadow:0 3px 12px rgba(0,0,0,0.4)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'opacity:0.35', 'transition:opacity .25s', 'cursor:pointer',
        '-webkit-user-select:none', 'user-select:none', '-webkit-touch-callout:none',
      ].join(';');
      let last = 0;
      const onTap = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        nextScale();
        brightenButton();
      };
      scaleBtn.addEventListener('touchend', onTap, true);
      scaleBtn.addEventListener('click', onTap, true);
    }
    if (!scaleBtn.isConnected) document.documentElement.appendChild(scaleBtn);
  }

  document.addEventListener('touchstart', brightenButton, { capture: true, passive: true });
  window.addEventListener('resize', function () { setTimeout(applyScale, 100); });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { applyScale(); verifyScale(); }, 300);
  });

  // ------------------------------------------------------------
  // Kleine Hinweis-Einblendung
  // ------------------------------------------------------------
  let toastEl = null;
  function toast(text, ms) {
    if (!toastEl) {
      if (!document.documentElement) return;
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed', 'bottom:calc(80px + env(safe-area-inset-bottom))',
        'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
        'padding:10px 18px', 'border-radius:20px', 'background:rgba(0,0,0,0.8)',
        'color:#fff', 'font:15px -apple-system,sans-serif', 'opacity:0',
        'transition:opacity .3s', 'pointer-events:none', 'text-align:center', 'max-width:80vw',
      ].join(';');
    }
    if (!toastEl.isConnected) document.documentElement.appendChild(toastEl);
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 2500);
  }

  function start() {
    applyScale();
    setTimeout(verifyScale, 600);
    buildScaleButton();
    // YouTube setzt den Viewport teils neu – regelmäßig nachziehen
    setInterval(function () { applyScale(); buildScaleButton(); }, 1000);
    toast('✓ YouTube-Skript aktiv – Größe mit ⤢ anpassen', 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
