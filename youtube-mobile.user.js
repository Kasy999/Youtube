// ==UserScript==
// @name         YouTube Mobile - Werbefrei und Hintergrund-Wiedergabe
// @namespace    yt-mobile-ipad
// @version      1.0.0
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

    // Sichtbarkeits-Meldungen abfangen, bevor YouTube sie sieht
    ['visibilitychange', 'webkitvisibilitychange'].forEach(function (type) {
      window.addEventListener(type, function (ev) { ev.stopImmediatePropagation(); }, true);
      document.addEventListener(type, function (ev) { ev.stopImmediatePropagation(); }, true);
    });
    window.addEventListener('blur', function (ev) {
      if (ev.target === window) ev.stopImmediatePropagation();
    }, true);

    // Unterscheiden: Hast DU pausiert, oder das System im Hintergrund?
    let userPausedAt = 0;
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
      const byUser = Date.now() - userPausedAt < 1500;
      const ended = video.ended;
      if (byUser || ended) { wasPlaying = false; return; }
      // Pause kam nicht von dir → im Hintergrund wieder starten
      if (wasPlaying && reallyHidden()) {
        setTimeout(function () {
          const p = video.play();
          if (p && p.catch) p.catch(function () {});
        }, 50);
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
  if (CONFIG.lockScreenControls && 'mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const getVideo = function () { return document.querySelector('video'); };
    const safe = function (action, fn) {
      try { ms.setActionHandler(action, fn); } catch (e) { /* nicht unterstützt */ }
    };

    safe('play', function () {
      const v = getVideo();
      if (v) { const p = v.play(); if (p && p.catch) p.catch(function () {}); }
    });
    safe('pause', function () { const v = getVideo(); if (v) v.pause(); });
    safe('seekbackward', function (d) {
      const v = getVideo(); if (v) v.currentTime = Math.max(0, v.currentTime - ((d && d.seekOffset) || 10));
    });
    safe('seekforward', function (d) {
      const v = getVideo(); if (v) v.currentTime = Math.min(v.duration || 1e9, v.currentTime + ((d && d.seekOffset) || 10));
    });
    safe('seekto', function (d) {
      const v = getVideo(); if (v && d && typeof d.seekTime === 'number') v.currentTime = d.seekTime;
    });

    let lastTitle = '';
    setInterval(function () {
      const v = getVideo();
      if (!v || v.paused || typeof MediaMetadata === 'undefined') return;
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
    }, 2000);
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

  document.addEventListener('DOMContentLoaded', function () {
    toast('✓ YouTube-Skript aktiv', 2500);
  });
})();
