// ==UserScript==
// @name         YouTube TV iPad - Werbefrei und Vollbild
// @namespace    yt-tv-ipad
// @version      1.4.0
// @description  Entfernt Werbung in der YouTube-TV-Oberflaeche, SponsorBlock, Touch-Steuerung und Vollbild fuer das iPad.
// @match        *://*.youtube.com/*
// @match        *://youtube.com/*
// @run-at       document-start
// @grant        none
// @sandbox      JavaScript
// @updateURL    https://raw.githubusercontent.com/Kasy999/Youtube/main/youtube-tv-ipad.user.js
// @downloadURL  https://raw.githubusercontent.com/Kasy999/Youtube/main/youtube-tv-ipad.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Nur in der TV-Oberflaeche (youtube.com/tv) aktiv werden
  if (!/^\/tv(\/|$)/.test(location.pathname)) return;

  // ------------------------------------------------------------
  // EINSTELLUNGEN – hier kannst du Funktionen an- und ausschalten
  // ------------------------------------------------------------
  const CONFIG = {
    adblock: true,                 // Werbung entfernen
    sponsorblock: true,            // Sponsor-Abschnitte automatisch überspringen
    sponsorCategories: [           // welche Abschnitte übersprungen werden
      'sponsor',        // bezahlte Werbung im Video
      'selfpromo',      // Eigenwerbung (Merch, Patreon …)
      'interaction',    // „Abonniert und liked …"
      // 'intro',       // Intros       – Kommentarzeichen entfernen zum Aktivieren
      // 'outro',       // Abspann
      // 'preview',     // Vorschau/Rückblick
      // 'music_offtopic', // Nicht-Musik-Teile in Musikvideos
    ],
    fullscreen: true,              // Seite beim Tippen ins Vollbild schalten
    touchNav: true,                // Wischen = Pfeiltasten wie auf der Fernbedienung
    swipeStepPx: 110,              // so viele Pixel Wischen = ein Schritt
    tapAsEnter: false,             // true, falls Antippen nichts auswählt
    longPressMs: 600,              // so lange drücken, bis die Knöpfe erscheinen
    hideAfterMs: 2000,             // Knöpfe verschwinden nach dieser Zeit wieder
  };

  // ------------------------------------------------------------
  // 1) WERBEBLOCKER
  // YouTube schickt Werbung als Teil der JSON-Antworten mit.
  // Wir entfernen diese Teile, bevor die Seite sie verarbeitet
  // (gleiches Prinzip wie bei TizenTube).
  // ------------------------------------------------------------
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const AD_RENDERERS = [
    'adSlotRenderer',
    'tvMastheadRenderer',
    'promotedSparklesWebRenderer',
    'actionCompanionAdRenderer',
    'adActionInterstitialRenderer',
  ];

  function isAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    for (const k of AD_RENDERERS) if (k in item) return true;
    return false;
  }

  function clean(obj, depth) {
    depth = depth || 0;
    if (!obj || typeof obj !== 'object' || depth > 40) return obj;
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
      ('responseContext' in r || 'playerResponse' in r || 'adPlacements' in r || 'playerAds' in r);
  }

  if (CONFIG.adblock) {
    const origParse = JSON.parse;
    JSON.parse = function () {
      const r = origParse.apply(this, arguments);
      try { if (looksLikeYouTube(r)) clean(r); } catch (e) { /* ignorieren */ }
      return r;
    };

    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.apply(this, arguments).then(function (r) {
        try { if (looksLikeYouTube(r)) clean(r); } catch (e) { /* ignorieren */ }
        return r;
      });
    };
  }

  // ------------------------------------------------------------
  // 2) SPONSORBLOCK
  // Holt von sponsor.ajay.app die von der Community markierten
  // Abschnitte und springt automatisch darüber.
  // ------------------------------------------------------------
  let currentId = null;
  let segments = [];

  function getVideoId() {
    const m = (location.hash + location.search).match(/[?&]v=([\w-]{11})/);
    return m ? m[1] : null;
  }

  async function loadSegments(id) {
    segments = [];
    try {
      const url = 'https://sponsor.ajay.app/api/skipSegments?videoID=' + id +
        '&categories=' + encodeURIComponent(JSON.stringify(CONFIG.sponsorCategories));
      const res = await fetch(url);
      if (!res.ok) return; // 404 = keine Abschnitte für dieses Video
      const data = await res.json();
      if (id === currentId && Array.isArray(data)) {
        segments = data.map(function (s) { return s.segment; });
      }
    } catch (e) { /* offline o. Ä. – einfach ignorieren */ }
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
  // 3) VOLLBILD
  // a) Die Seite füllt immer den ganzen sichtbaren Bereich aus
  //    (auch unter Notch/abgerundeten Ecken, ohne Ränder).
  // b) Beim Tippen wird echtes Vollbild angefordert. iPadOS
  //    erlaubt das nur nach einer Berührung – und nur, wenn der
  //    Browser es zulässt. Geht es nicht, schickt der Knopf ⛶
  //    das laufende Video in den nativen iPad-Player.
  // ------------------------------------------------------------
  function applyFillStyles() {
    if (document.getElementById('yttv-fill-style')) return;
    const css = [
      'html, body {',
      '  margin:0 !important; padding:0 !important;',
      '  width:100% !important; height:100% !important;',
      '  min-height:100dvh !important;',
      '  overflow:hidden !important; background:#000 !important;',
      '  overscroll-behavior:none !important;',
      '  -webkit-touch-callout:none !important;', // kein Popup bei langem Drücken
      '  -webkit-user-select:none !important; user-select:none !important;',
      '  -webkit-tap-highlight-color:transparent !important;',
      '}',
    ].join('\n');
    const style = document.createElement('style');
    style.id = 'yttv-fill-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);

    // Viewport so setzen, dass auch die Randbereiche genutzt werden
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      (document.head || document.documentElement).appendChild(vp);
    }
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  }

  let wantFs = CONFIG.fullscreen;

  function pageFsSupported() {
    const el = document.documentElement;
    const hasFn = !!(el.requestFullscreen || el.webkitRequestFullscreen);
    const enabled = document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
    return hasFn && enabled;
  }

  function isFs() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  // Ausweichlösung: laufendes Video im nativen iPad-Player öffnen
  function videoFs() {
    const video = document.querySelector('video');
    if (video && typeof video.webkitEnterFullscreen === 'function') {
      try { video.webkitEnterFullscreen(); return true; } catch (e) { /* ignorieren */ }
    }
    return false;
  }

  function enterFs(fromButton) {
    if (!pageFsSupported()) {
      if (fromButton && !videoFs()) {
        toast('Seiten-Vollbild erlaubt der Browser nicht – starte ein Video und tippe dann auf ⛶', 3500);
      }
      return;
    }
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    try {
      const p = fn.call(el);
      if (p && p.catch) p.catch(function () { if (fromButton) videoFs(); });
    } catch (e) { if (fromButton) videoFs(); }
  }

  function exitFs() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn) return;
    try {
      const p = fn.call(document);
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignorieren */ }
  }

  // ------------------------------------------------------------
  // 4) TASTEN DER FERNBEDIENUNG NACHBILDEN
  // ------------------------------------------------------------
  const KEYS = {
    up:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
    down:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
    left:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    enter: { key: 'Enter',      code: 'Enter',      keyCode: 13 },
    back:  { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  };

  function sendKey(k) {
    const target = document.activeElement || document.body || document.documentElement;
    ['keydown', 'keyup'].forEach(function (type) {
      const ev = new KeyboardEvent(type, { key: k.key, code: k.code, bubbles: true, cancelable: true });
      try {
        Object.defineProperty(ev, 'keyCode', { get: function () { return k.keyCode; } });
        Object.defineProperty(ev, 'which', { get: function () { return k.keyCode; } });
      } catch (e) { /* ignorieren */ }
      target.dispatchEvent(ev);
    });
  }

  function sendKeys(k, count) {
    for (let i = 0; i < count; i++) {
      setTimeout(function () { sendKey(k); }, i * 70);
    }
  }

  // ------------------------------------------------------------
  // 5) KNÖPFE (unsichtbar, erscheinen bei langem Drücken)
  // ------------------------------------------------------------
  let fsBtn = null;
  let backBtn = null;
  let toastEl = null;
  let hideTimer = null;

  function makeButton(id, label, side) {
    const b = document.createElement('div');
    b.id = id;
    b.textContent = label;
    b.style.cssText = [
      'position:fixed', 'top:calc(16px + env(safe-area-inset-top))',
      side + ':calc(16px + env(safe-area-inset-' + side + '))',
      'z-index:2147483647',
      'width:60px', 'height:60px', 'border-radius:30px',
      'background:rgba(0,0,0,0.75)', 'color:#fff', 'font-size:30px',
      'border:2px solid rgba(255,255,255,0.7)',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'opacity:0', 'pointer-events:none', 'transition:opacity .25s',
      '-webkit-user-select:none', 'user-select:none', '-webkit-touch-callout:none',
    ].join(';');
    return b;
  }

  function showControls() {
    [fsBtn, backBtn].forEach(function (b) {
      if (!b) return;
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
    });
    clearTimeout(hideTimer);
  }

  function hideControls() {
    [fsBtn, backBtn].forEach(function (b) {
      if (!b) return;
      b.style.opacity = '0';
      b.style.pointerEvents = 'none';
    });
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideControls, CONFIG.hideAfterMs);
  }

  function toast(text, ms) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 2500);
  }

  // Ein Knopf soll bei touchend + click nicht doppelt auslösen
  function buttonHandler(action) {
    let last = 0;
    return function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      const now = Date.now();
      if (now - last < 600) return;
      last = now;
      action();
      scheduleHide();
    };
  }

  function onFsButton() {
    if (isFs()) { wantFs = false; exitFs(); toast('Vollbild aus'); }
    else { wantFs = true; enterFs(true); }
  }

  function onBackButton() {
    sendKey(KEYS.back);
  }

  function buildUi() {
    const root = document.documentElement;
    applyFillStyles();

    if (!fsBtn) {
      fsBtn = makeButton('yttv-fs-btn', '⛶', 'right');
      const h = buttonHandler(onFsButton);
      fsBtn.addEventListener('touchend', h, true);
      fsBtn.addEventListener('click', h, true);
    }
    if (!backBtn) {
      backBtn = makeButton('yttv-back-btn', '←', 'left');
      const h = buttonHandler(onBackButton);
      backBtn.addEventListener('touchend', h, true);
      backBtn.addEventListener('click', h, true);
    }
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed', 'bottom:calc(40px + env(safe-area-inset-bottom))',
        'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'padding:10px 18px', 'border-radius:20px',
        'background:rgba(0,0,0,0.8)', 'color:#fff', 'font:16px -apple-system,sans-serif',
        'opacity:0', 'transition:opacity .3s', 'pointer-events:none', 'text-align:center',
        'max-width:80vw',
      ].join(';');
    }

    // Direkt an <html> hängen: Die TV-Oberfläche baut <body> teilweise neu
    // auf und würde die Knöpfe sonst wieder entfernen.
    [fsBtn, backBtn, toastEl].forEach(function (el) {
      if (!el.isConnected) root.appendChild(el);
    });
  }

  // ------------------------------------------------------------
  // 6) TOUCH-GESTEN
  //   kurz tippen          → Vollbild anfordern (+ ggf. Auswahl)
  //   lange drücken        → Knöpfe einblenden (2 s nach Loslassen weg)
  //   nach oben wischen    → runter     nach links wischen  → rechts
  //   nach unten wischen   → hoch       nach rechts wischen → links
  //   vom linken Rand nach rechts wischen → Zurück
  // ------------------------------------------------------------
  function isOwnUi(el) {
    return el && el.closest && el.closest('#yttv-fs-btn, #yttv-back-btn');
  }

  let sx = 0, sy = 0, st = 0;
  let tracking = false;
  let longPressed = false;
  let lpTimer = null;

  document.addEventListener('touchstart', function (ev) {
    if (isOwnUi(ev.target)) { tracking = false; return; }
    if (ev.touches.length !== 1) { tracking = false; clearTimeout(lpTimer); return; }
    const t = ev.touches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
    tracking = true;
    longPressed = false;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(function () {
      longPressed = true;
      showControls();
    }, CONFIG.longPressMs);
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', function (ev) {
    if (!tracking) return;
    const t = ev.touches[0];
    if (Math.abs(t.clientX - sx) > 15 || Math.abs(t.clientY - sy) > 15) {
      clearTimeout(lpTimer); // Bewegung = kein langes Drücken
    }
    // Normales Scrollen/Zoomen unterdrücken, sonst wackelt alles
    if (CONFIG.touchNav) ev.preventDefault();
  }, { capture: true, passive: false });

  document.addEventListener('touchend', function (ev) {
    clearTimeout(lpTimer);
    if (!tracking) return;
    tracking = false;

    // Langes Drücken: nur Knöpfe zeigen, sonst nichts auslösen
    if (longPressed) {
      ev.preventDefault();
      ev.stopPropagation();
      scheduleHide();
      return;
    }

    // Jede normale Berührung ist eine Chance, ins Vollbild zu gehen
    if (wantFs && !isFs()) enterFs(false);

    const t = ev.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const dist = Math.max(adx, ady);

    // Antippen
    if (dist < 15) {
      if (CONFIG.tapAsEnter) { ev.preventDefault(); sendKey(KEYS.enter); }
      return;
    }
    if (!CONFIG.touchNav || dist < 40) return;

    ev.preventDefault();

    // Vom linken Rand nach rechts = Zurück
    if (sx < 30 && dx > 80 && adx > ady) { sendKey(KEYS.back); return; }

    // Schnelles Wischen gibt ein paar Schritte extra
    const fast = (Date.now() - st) < 200 ? 1.5 : 1;
    const steps = Math.min(8, Math.max(1, Math.round(dist / CONFIG.swipeStepPx * fast)));

    if (adx > ady) sendKeys(dx < 0 ? KEYS.right : KEYS.left, steps);
    else sendKeys(dy < 0 ? KEYS.down : KEYS.up, steps);
  }, { capture: true, passive: false });

  document.addEventListener('touchcancel', function () {
    clearTimeout(lpTimer);
    tracking = false;
    if (longPressed) scheduleHide();
  }, { capture: true, passive: true });

  // Kontextmenü/Lupe bei langem Drücken unterdrücken
  document.addEventListener('contextmenu', function (ev) { ev.preventDefault(); }, true);

  // ------------------------------------------------------------
  // START
  // ------------------------------------------------------------
  function start() {
    buildUi();
    toast('✓ TV-Skript aktiv – lange drücken für Knöpfe', 3500);
    // Falls die Seite unsere Elemente entfernt: jede Sekunde wieder einfügen
    setInterval(buildUi, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
