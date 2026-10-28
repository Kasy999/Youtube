// ==UserScript==
// @name         YouTube Mobile - Werbefrei und Hintergrund-Wiedergabe
// @namespace    yt-mobile-ipad
// @version      1.5.0
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

  // Läuft das Skript in der Stöber-Ebene des Mini-Players?
  let IN_BROWSE_FRAME = false;
  try { IN_BROWSE_FRAME = window.top !== window && window.name === 'ytm-browse'; } catch (e) { IN_BROWSE_FRAME = true; }

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
    rotateFullscreen: true,        // Querformat drehen = Vollbild
    tapRealFullscreen: true,       // im Vollbild antippen = echtes Vollbild ohne Adressleiste
    landscapeNative: true,         // Querformat = Videoplayer des Geräts, Hochformat = Web-Player
    miniPlayer: true,              // Video nach unten ziehen = Mini-Player
  };

  // In der Stöber-Ebene nur den Werbeblocker nutzen
  if (IN_BROWSE_FRAME) {
    CONFIG.sponsorblock = false;
    CONFIG.backgroundPlay = false;
    CONFIG.lockScreenControls = false;
    CONFIG.scaleButton = false;
    CONFIG.rotateFullscreen = false;
    CONFIG.miniPlayer = false;
  }

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
      if (!document.documentElement) { setTimeout(injectCss, 10); return; }
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

  function nativeFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    const v = document.querySelector('video');
    return !!(v && v.webkitDisplayingFullscreen);
  }

  function applyScale() {
    if (IN_BROWSE_FRAME) return;
    const vp = getViewportMeta();
    const root = document.documentElement;
    // Im Vollbild/Mini-Player immer Originalgröße, sonst wird der Player
    // durch die Verkleinerung mitverkleinert und füllt den Schirm nicht
    let busy = false;
    try { busy = fsActive || miniActive || nativeFullscreen(); } catch (e) { /* noch nicht bereit */ }
    const s = busy ? 1 : scale;
    if (useZoomFallback) {
      // Ausweichweg: Seite per CSS verkleinern
      if (vp && vp.content !== viewportContent(1)) vp.content = viewportContent(1);
      root.style.zoom = s === 1 ? '' : String(s);
      return;
    }
    root.style.zoom = '';
    if (vp && vp.content !== viewportContent(s)) vp.content = viewportContent(s);
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
  // 6) QUERFORMAT = VOLLBILD
  // Läuft ein Video im Hochformat und du drehst das Gerät quer,
  // füllt der Player den ganzen Bildschirm. Zurück ins Hochformat
  // = wieder wie vorher. (Nur beim Drehen, nicht beim Öffnen.)
  // ------------------------------------------------------------
  const PLAYER_SEL = '#player-container-id, .player-container, ytm-player';

  function isWatchPage() { return location.pathname === '/watch'; }
  function isPortrait() { return window.innerHeight >= window.innerWidth; }
  function findPlayer() {
    const els = document.querySelectorAll(PLAYER_SEL);
    for (let i = 0; i < els.length; i++) {
      if (els[i].querySelector('video')) return els[i];
    }
    const v = document.querySelector('video');
    return v ? (v.closest('.html5-video-player') || v.parentElement) : null;
  }
  function nudgeLayout() {
    // YouTube berechnet die Player-Größe beim „resize" neu
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 50);
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 400);
  }

  const PLAYER_CSS = [
    // gemeinsame Regeln, damit das Video seinen Kasten ausfüllt
    'html.ytm-fs .ytm-player-host, html.ytm-mini .ytm-player-host {',
    '  position:fixed !important; margin:0 !important; padding:0 !important;',
    '  transform:none !important; background:#000 !important;',
    '}',
    'html.ytm-fs .ytm-player-host *:not(video):not(.ytp-chrome-bottom):not(.ytp-chrome-bottom *),',
    'html.ytm-mini .ytm-player-host #player, html.ytm-mini .ytm-player-host .html5-video-player,',
    'html.ytm-mini .ytm-player-host .html5-video-container {',
    '  max-width:none !important; max-height:none !important;',
    '}',
    'html.ytm-fs .ytm-player-host #player, html.ytm-fs .ytm-player-host .html5-video-player,',
    'html.ytm-fs .ytm-player-host .html5-video-container,',
    'html.ytm-mini .ytm-player-host #player, html.ytm-mini .ytm-player-host .html5-video-player,',
    'html.ytm-mini .ytm-player-host .html5-video-container {',
    '  width:100% !important; height:100% !important; padding:0 !important;',
    '}',
    'html.ytm-fs .ytm-player-host video, html.ytm-mini .ytm-player-host video {',
    '  width:100% !important; height:100% !important; left:0 !important; top:0 !important;',
    '  object-fit:contain !important;',
    '}',
    // Vollbild
    'html.ytm-fs .ytm-player-host {',
    '  top:0 !important; left:0 !important; right:0 !important; bottom:0 !important;',
    '  width:100vw !important; height:100vh !important; height:100dvh !important;',
    '  z-index:2147483640 !important;',
    '}',
    'html.ytm-fs, html.ytm-fs body { overflow:hidden !important; }',
    'html.ytm-fs #ytm-scale-btn { display:none !important; }',
    // Mini-Player unten rechts
    'html.ytm-mini .ytm-player-host {',
    '  top:auto !important; left:auto !important;',
    '  right:calc(12px + env(safe-area-inset-right)) !important;',
    '  bottom:calc(12px + env(safe-area-inset-bottom)) !important;',
    '  width:46vw !important; height:calc(46vw * 9 / 16) !important;',
    '  z-index:2147483641 !important; border-radius:10px !important; overflow:hidden !important;',
    '  box-shadow:0 6px 24px rgba(0,0,0,0.55) !important;',
    '}',
    '@media (orientation: landscape) {',
    '  html.ytm-mini .ytm-player-host { width:30vw !important; height:calc(30vw * 9 / 16) !important; }',
    '}',
    'html.ytm-mini .ytm-player-host .ytp-chrome-top, html.ytm-mini .ytm-player-host .ytp-chrome-bottom,',
    'html.ytm-mini .ytm-player-host .player-controls-content, html.ytm-mini .ytm-player-host ytm-custom-control',
    '  { display:none !important; }',
    'html.ytm-mini #ytm-scale-btn { display:none !important; }',
  ].join('\n');

  function injectPlayerCss() {
    if (document.getElementById('ytm-player-css')) return;
    const st = document.createElement('style');
    st.id = 'ytm-player-css';
    st.textContent = PLAYER_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  let playerHost = null;
  function markHost() {
    const p = findPlayer();
    if (playerHost && playerHost !== p) playerHost.classList.remove('ytm-player-host');
    playerHost = p;
    if (p) p.classList.add('ytm-player-host');
    return p;
  }

  let fsActive = false;
  let fsExitBtn = null;

  function enterLandscapeFs() {
    if (fsActive || miniActive) return;
    const v = document.querySelector('video');
    if (!isWatchPage() || !v || !markHost()) return;
    fsActive = true;
    document.documentElement.classList.add('ytm-fs');
    applyScale();
    showFsExit();
    nudgeLayout();
    if (CONFIG.tapRealFullscreen) toast('Antippen für Vollbild', 2500);
  }

  function exitLandscapeFs() {
    if (!fsActive) return;
    fsActive = false;
    document.documentElement.classList.remove('ytm-fs');
    if (fsExitBtn) fsExitBtn.style.display = 'none';
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl === playerHost) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      try { const pr = ex.call(document); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* ignorieren */ }
    }
    applyScale();
    nudgeLayout();
  }

  // kleiner Knopf zum manuellen Verlassen (blendet sich aus)
  function showFsExit() {
    if (!fsExitBtn) {
      fsExitBtn = document.createElement('div');
      fsExitBtn.id = 'ytm-fs-exit';
      fsExitBtn.textContent = '✕';
      fsExitBtn.style.cssText = [
        'position:fixed', 'top:calc(14px + env(safe-area-inset-top))',
        'left:calc(14px + env(safe-area-inset-left))', 'z-index:2147483647',
        'width:44px', 'height:44px', 'border-radius:22px', 'background:rgba(0,0,0,0.6)',
        'color:#fff', 'font:20px -apple-system,sans-serif', 'display:flex',
        'align-items:center', 'justify-content:center', 'transition:opacity .3s',
        '-webkit-user-select:none', 'user-select:none',
      ].join(';');
      const onTap = function (ev) { ev.preventDefault(); ev.stopPropagation(); exitLandscapeFs(); };
      fsExitBtn.addEventListener('touchend', onTap, true);
      fsExitBtn.addEventListener('click', onTap, true);
    }
    if (!fsExitBtn.isConnected) document.documentElement.appendChild(fsExitBtn);
    fsExitBtn.style.display = 'flex';
    fsExitBtn.style.opacity = '1';
    clearTimeout(fsExitBtn._t);
    fsExitBtn._t = setTimeout(function () { fsExitBtn.style.opacity = '0'; }, 2500);
  }

  let wasPortrait = isPortrait();
  function onOrientation() {
    const portrait = isPortrait();
    if (portrait === wasPortrait) return;
    wasPortrait = portrait;
    if (!CONFIG.rotateFullscreen) return;
    // YouTubes eigenes Vollbild ist aktiv → nicht dazwischenfunken
    if (nativeFullscreen()) { exitLandscapeFs(); return; }
    const v = document.querySelector('video');
    if (!portrait) {
      if (!v || v.paused || !isWatchPage() || miniActive) return;
      if (CONFIG.landscapeNative && enterNativePlayer(v)) {
        // Prüfen, ob das Gerät den Wechsel ohne Antippen zugelassen hat
        setTimeout(function () {
          if (!v.webkitDisplayingFullscreen && !isPortrait()) enterLandscapeFs();
        }, 600);
        return;
      }
      enterLandscapeFs();
    } else {
      // Hochformat: Videoplayer des Geräts verlassen, zurück zum Web-Player
      if (v && v.webkitDisplayingFullscreen && typeof v.webkitExitFullscreen === 'function') {
        try { v.webkitExitFullscreen(); } catch (e) { /* ignorieren */ }
      }
      exitLandscapeFs();
    }
  }

  // Im Hochformat immer im Web-Player bleiben (nicht im Geräte-Player)
  function ensureInline() {
    document.querySelectorAll('video').forEach(function (v) {
      if (!v.hasAttribute('playsinline')) v.setAttribute('playsinline', '');
      if (!v.hasAttribute('webkit-playsinline')) v.setAttribute('webkit-playsinline', '');
      v.playsInline = true;
    });
  }

  // Video im Videoplayer des Geräts öffnen (true = Aufruf möglich)
  let nativeWasPlaying = false;
  function enterNativePlayer(v) {
    if (!v || typeof v.webkitEnterFullscreen !== 'function') return false;
    nativeWasPlaying = !v.paused;
    try { v.webkitEnterFullscreen(); return true; } catch (e) { return false; }
  }

  // Echtes Vollbild (blendet die Adressleiste aus). Geht nur direkt
  // nach einem Antippen – deshalb beim ersten Tippen im Dreh-Vollbild.
  // 1. Versuch: ganzer Player im Vollbild (Seiten-Vollbild)
  // 2. Versuch: nativer iPad/iPhone-Videoplayer
  let preferVideoFs = false;
  function requestRealFullscreen() {
    const v = document.querySelector('video');
    const el = playerHost;
    const elFn = el && (el.requestFullscreen || el.webkitRequestFullscreen);
    const allowed = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (CONFIG.landscapeNative && enterNativePlayer(v)) return;
    if (!preferVideoFs && elFn && allowed) {
      try {
        const pr = elFn.call(el);
        if (pr && pr.catch) pr.catch(function () { preferVideoFs = true; });
      } catch (e) { preferVideoFs = true; }
      // Hat es nicht geklappt, nimmt der nächste Tipp den Videoplayer
      setTimeout(function () {
        if (!nativeFullscreen()) {
          preferVideoFs = true;
          toast('Nochmal tippen', 1500);
        }
      }, 700);
      return;
    }
    if (v && typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); } catch (e) { /* ignorieren */ }
    }
  }

  document.addEventListener('touchend', function (ev) {
    if (!fsActive || !CONFIG.tapRealFullscreen || nativeFullscreen()) return;
    if (fsExitBtn && fsExitBtn.contains(ev.target)) return;
    if (!playerHost || !playerHost.contains(ev.target)) return;
    requestRealFullscreen();
  }, true);

  // YouTubes Vollbild-Knopf abfangen, wenn der Browser kein Seiten-
  // Vollbild erlaubt (sonst meldet YouTube „nicht unterstützt").
  // Stattdessen öffnet sich das Video im Videoplayer des iPads.
  const FS_BUTTON_SEL = [
    '.fullscreen-icon', 'button.fullscreen-icon', '.ytp-fullscreen-button',
    'ytm-fullscreen-button', '.player-controls-fullscreen',
    'button[aria-label*="ollbild"]', 'button[aria-label*="ull screen"]',
    'button[aria-label*="ullscreen"]',
  ].join(',');
  let lastFsTap = 0;
  function onYtFullscreenButton(ev) {
    if (IN_BROWSE_FRAME) return;
    const t = ev.target;
    const btn = t && t.closest && t.closest(FS_BUTTON_SEL);
    if (!btn) return;
    const allowed = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (allowed) return; // Browser kann es selbst → YouTube machen lassen
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const now = Date.now();
    if (now - lastFsTap < 600) return;
    lastFsTap = now;
    const v = document.querySelector('video');
    if (v && typeof v.webkitEnterFullscreen === 'function') {
      try { v.webkitEnterFullscreen(); return; } catch (e) { /* weiter unten */ }
    }
    // letzter Ausweg: Player füllt die Seite (Adressleiste bleibt)
    if (fsActive) exitLandscapeFs(); else { markHost(); enterLandscapeFs(); }
  }
  ['touchend', 'click', 'pointerup'].forEach(function (type) {
    window.addEventListener(type, onYtFullscreenButton, true);
  });

  // YouTubes eigener Vollbild-Knopf: unseres abschalten, Größe richtig setzen
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (type) {
    document.addEventListener(type, function () {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      // Unser eigener Player im Vollbild → Dreh-Vollbild beibehalten
      if (fsEl && playerHost && fsEl === playerHost) { applyScale(); return; }
      // Vollbild beendet und Gerät steht hochkant → alles zurücksetzen
      if (!fsEl && isPortrait()) exitLandscapeFs();
      if (fsEl) exitLandscapeFs();
      applyScale();
      setTimeout(function () { wasPortrait = isPortrait(); }, 400);
    }, true);
  });
  ['webkitbeginfullscreen', 'webkitendfullscreen'].forEach(function (type) {
    document.addEventListener(type, function () {
      if (type === 'webkitbeginfullscreen') exitLandscapeFs();
      if (type === 'webkitendfullscreen' && nativeWasPlaying) {
        // iOS pausiert beim Verlassen gern – weiterspielen
        const v = document.querySelector('video');
        setTimeout(function () {
          if (v && v.paused && !v.ended) { const pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
        }, 200);
      }
      if (type === 'webkitendfullscreen' && !isPortrait()) {
        // zurück aus dem Videoplayer, Gerät noch quer → Dreh-Vollbild behalten
        applyScale();
        return;
      }
      exitLandscapeFs();
      applyScale();
      setTimeout(function () { wasPortrait = isPortrait(); }, 400);
    }, true);
  });

  // ------------------------------------------------------------
  // 7) MINI-PLAYER (wie in der YouTube-App)
  // Im Hochformat das Video nach unten ziehen → es spielt klein
  // unten rechts weiter, darüber kannst du normal weiterstöbern.
  // Antippen des Mini-Players = wieder groß. ✕ = schließen.
  // Technik: Die Videoseite bleibt im Hintergrund erhalten (damit
  // das Video weiterläuft), zum Stöbern wird YouTube in einer
  // Ebene darüber geladen.
  // ------------------------------------------------------------
  let miniActive = false;
  let browseFrame = null;
  let miniOverlay = null;
  let lastBrowseUrl = '/';
  try { lastBrowseUrl = sessionStorage.getItem('ytm-last-browse') || '/'; } catch (e) { /* ignorieren */ }

  // Merken, wo du vor dem Video warst
  let lastPath = location.pathname + location.search;
  setInterval(function () {
    const cur = location.pathname + location.search;
    if (cur === lastPath) return;
    if (!/^\/(watch|shorts)/.test(location.pathname)) {
      lastBrowseUrl = cur;
      try { sessionStorage.setItem('ytm-last-browse', cur); } catch (e) { /* ignorieren */ }
    }
    lastPath = cur;
    // Videoseite verlassen → Vollbild/Mini aufräumen
    if (!isWatchPage()) { exitLandscapeFs(); if (miniActive) closeMini(false); }
  }, 500);

  function buildMiniOverlay() {
    if (miniOverlay) return miniOverlay;
    const o = document.createElement('div');
    o.id = 'ytm-mini-overlay';
    o.style.cssText = [
      'position:fixed', 'z-index:2147483643', 'display:none',
      '-webkit-user-select:none', 'user-select:none', '-webkit-touch-callout:none',
    ].join(';');
    const close = document.createElement('div');
    close.textContent = '✕';
    close.style.cssText = [
      'position:absolute', 'top:4px', 'right:4px', 'width:32px', 'height:32px',
      'border-radius:16px', 'background:rgba(0,0,0,0.65)', 'color:#fff',
      'font:16px -apple-system,sans-serif', 'display:flex', 'align-items:center',
      'justify-content:center',
    ].join(';');
    const pp = document.createElement('div');
    pp.textContent = '⏯';
    pp.style.cssText = close.style.cssText.replace('right:4px', 'left:4px');

    let last = 0;
    const guard = function (fn) {
      return function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        const now = Date.now(); if (now - last < 500) return; last = now;
        fn();
      };
    };
    const onClose = guard(function () { closeMini(true); });
    const onPP = guard(function () {
      const v = document.querySelector('video');
      if (!v) return;
      if (v.paused) { userPausedAt = 0; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
      else { userPausedAt = Date.now(); v.pause(); }
    });
    const onRestore = guard(function () { restoreFromMini(); });
    close.addEventListener('touchend', onClose, true); close.addEventListener('click', onClose, true);
    pp.addEventListener('touchend', onPP, true); pp.addEventListener('click', onPP, true);
    o.addEventListener('touchend', onRestore, false); o.addEventListener('click', onRestore, false);
    o.appendChild(pp);
    o.appendChild(close);
    miniOverlay = o;
    return o;
  }

  function positionOverlay() {
    if (!miniOverlay || !playerHost) return;
    const r = playerHost.getBoundingClientRect();
    miniOverlay.style.left = r.left + 'px';
    miniOverlay.style.top = r.top + 'px';
    miniOverlay.style.width = r.width + 'px';
    miniOverlay.style.height = r.height + 'px';
  }

  function enterMini() {
    if (miniActive || !isWatchPage() || !markHost()) return;
    miniActive = true;
    exitLandscapeFs();

    // Stöber-Ebene mit der letzten YouTube-Seite
    browseFrame = document.createElement('iframe');
    browseFrame.name = 'ytm-browse';
    browseFrame.src = lastBrowseUrl || '/';
    browseFrame.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100vw', 'height:100vh', 'height:100dvh',
      'border:0', 'z-index:2147483638', 'background:#fff',
    ].join(';');
    document.documentElement.appendChild(browseFrame);

    playerHost.style.transform = '';
    document.documentElement.classList.add('ytm-mini');
    applyScale();
    const o = buildMiniOverlay();
    if (!o.isConnected) document.documentElement.appendChild(o);
    o.style.display = 'block';
    nudgeLayout();
    setTimeout(positionOverlay, 60);
    setTimeout(positionOverlay, 450);
  }

  function teardownMini() {
    miniActive = false;
    document.documentElement.classList.remove('ytm-mini');
    applyScale();
    if (miniOverlay) miniOverlay.style.display = 'none';
    if (browseFrame) {
      try {
        const loc = browseFrame.contentWindow.location;
        if (!/^\/(watch|shorts)/.test(loc.pathname)) {
          lastBrowseUrl = loc.pathname + loc.search;
          sessionStorage.setItem('ytm-last-browse', lastBrowseUrl);
        }
      } catch (e) { /* ignorieren */ }
      browseFrame.remove();
      browseFrame = null;
    }
    nudgeLayout();
  }

  function restoreFromMini() {
    if (!miniActive) return;
    teardownMini();
    window.scrollTo(0, 0);
  }

  // ✕: Video stoppen und auf der gerade angesehenen Seite bleiben
  function closeMini(stopVideo) {
    if (!miniActive) return;
    let target = null;
    try {
      const loc = browseFrame.contentWindow.location;
      target = loc.pathname + loc.search;
    } catch (e) { /* ignorieren */ }
    if (stopVideo) {
      const v = document.querySelector('video');
      if (v) { userPausedAt = Date.now(); v.pause(); }
    }
    teardownMini();
    if (stopVideo) location.href = target || lastBrowseUrl || '/';
  }

  // Video in der Stöber-Ebene gewählt → dieses Video groß öffnen
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'ytm-open') return;
    teardownMini();
    location.href = ev.data.href;
  });

  // Sicherheitsnetz: falls die Ebene doch auf eine Videoseite wechselt
  setInterval(function () {
    if (!miniActive || !browseFrame) return;
    try {
      const w = browseFrame.contentWindow;
      w.document.querySelectorAll('video').forEach(function (v) { v.muted = true; });
      if (w.location.pathname === '/watch' || /^\/shorts\//.test(w.location.pathname)) {
        const href = w.location.pathname + w.location.search;
        teardownMini();
        location.href = href;
      }
    } catch (e) { /* ignorieren */ }
    positionOverlay();
  }, 400);

  // Wischgeste: Video im Hochformat nach unten ziehen
  let dragStartY = 0, dragStartX = 0, dragging = false, dragDy = 0, dragCandidate = false;

  document.addEventListener('touchstart', function (ev) {
    dragCandidate = false;
    if (!CONFIG.miniPlayer || miniActive || fsActive || IN_BROWSE_FRAME) return;
    if (!isWatchPage() || !isPortrait() || ev.touches.length !== 1) return;
    const host = markHost();
    if (!host || !host.contains(ev.target)) return;
    const t = ev.touches[0];
    dragStartX = t.clientX; dragStartY = t.clientY;
    dragging = false; dragDy = 0; dragCandidate = true;
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', function (ev) {
    if (!dragCandidate) return;
    const t = ev.touches[0];
    const dy = t.clientY - dragStartY;
    const dx = t.clientX - dragStartX;
    if (!dragging) {
      if (dy > 14 && dy > Math.abs(dx) * 1.5) dragging = true;
      else if (Math.abs(dx) > 14 || dy < -14) { dragCandidate = false; return; }
      else return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    dragDy = Math.max(0, dy);
    const s = Math.max(0.5, 1 - dragDy / 800);
    playerHost.style.transition = 'none';
    playerHost.style.transformOrigin = '100% 0';
    playerHost.style.transform = 'translateY(' + dragDy + 'px) scale(' + s + ')';
  }, { capture: true, passive: false });

  function endDrag(ev) {
    if (!dragCandidate) return;
    dragCandidate = false;
    if (!dragging) return;
    dragging = false;
    if (ev && ev.cancelable) { ev.preventDefault(); ev.stopPropagation(); }
    if (dragDy > 110) {
      playerHost.style.transition = '';
      enterMini();
    } else {
      playerHost.style.transition = 'transform .2s';
      playerHost.style.transform = '';
      setTimeout(function () { if (playerHost) playerHost.style.transition = ''; }, 250);
    }
  }
  document.addEventListener('touchend', endDrag, { capture: true, passive: false });
  document.addEventListener('touchcancel', endDrag, { capture: true, passive: false });

  // ------------------------------------------------------------
  // In der Stöber-Ebene: Videos nicht dort öffnen, sondern groß
  // ------------------------------------------------------------
  function setupBrowseFrame() {
    document.addEventListener('click', function (ev) {
      const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!/^(https?:\/\/[^/]*youtube\.com)?\/(watch\?|shorts\/)/.test(href)) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      try { window.parent.postMessage({ type: 'ytm-open', href: href }, location.origin); } catch (e) { /* ignorieren */ }
    }, true);
  }

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
    if (IN_BROWSE_FRAME) { setupBrowseFrame(); return; }
    injectPlayerCss();
    window.addEventListener('resize', onOrientation);
    ensureInline();
    setInterval(ensureInline, 1000);
    window.addEventListener('orientationchange', function () { setTimeout(onOrientation, 250); });
    applyScale();
    setTimeout(verifyScale, 600);
    buildScaleButton();
    // YouTube setzt den Viewport teils neu – regelmäßig nachziehen
    setInterval(function () { applyScale(); buildScaleButton(); }, 1000);
    toast('✓ YouTube-Skript aktiv', 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
