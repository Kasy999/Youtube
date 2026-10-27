// ==UserScript==
// @name         YouTube TV iPad - Werbefrei und Vollbild
// @namespace    yt-tv-ipad
// @version      1.3.1
// @description  Entfernt Werbung in der YouTube-TV-Oberflaeche, SponsorBlock, Touch-Steuerung und Vollbild fuer das iPad.
// @match        https://www.youtube.com/tv*
// @match        https://youtube.com/tv*
// @match        https://m.youtube.com/tv*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

(function () {
  'use strict';

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
    autoFullscreen: true,          // beim Tippen automatisch ins Vollbild
    fullscreenButton: true,        // kleiner Vollbild-Knopf oben rechts
    touchNav: true,                // Wischen = Pfeiltasten wie auf der Fernbedienung
    swipeStepPx: 110,              // so viele Pixel Wischen = ein Schritt
    backButton: true,              // Zurück-Knopf oben links
    tapAsEnter: false,             // true, falls Antippen nichts auswählt
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
  // iPadOS erlaubt Vollbild nur nach einer Berührung.
  // Deshalb: beim Tippen automatisch ins Vollbild, plus Knopf
  // oben rechts zum Ein-/Ausschalten.
  // ------------------------------------------------------------
  let autoFs = CONFIG.autoFullscreen;

  // Kann der Browser die ganze Seite ins Vollbild schalten?
  // (Orion/WKWebView erlaubt das oft nicht.)
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
        toast('Seiten-Vollbild geht in Orion nicht – starte ein Video und tippe dann auf ⛶');
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

  document.addEventListener('touchend', function (ev) {
    if (ev.target && ev.target.id === 'yttv-fs-btn') return;
    if (autoFs && !isFs()) enterFs();
    showButton();
  }, true);

  // ------------------------------------------------------------
  // 4) TOUCH-STEUERUNG
  // Die TV-Oberfläche kennt nur Fernbedienungs-Tasten. Wir
  // übersetzen Wischgesten in Pfeiltasten:
  //   nach oben wischen   → runter      nach links wischen  → rechts
  //   nach unten wischen  → hoch        nach rechts wischen → links
  //   vom linken Rand nach rechts wischen → Zurück
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

  function isOwnUi(el) {
    return el && el.closest && el.closest('#yttv-fs-btn, #yttv-back-btn');
  }

  if (CONFIG.touchNav) {
    let sx = 0, sy = 0, st = 0, tracking = false;

    document.addEventListener('touchstart', function (ev) {
      if (ev.touches.length !== 1 || isOwnUi(ev.target)) { tracking = false; return; }
      const t = ev.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now(); tracking = true;
    }, { capture: true, passive: true });

    // Normales Scrollen/Zoomen der Seite unterdrücken, sonst wackelt alles
    document.addEventListener('touchmove', function (ev) {
      if (tracking) ev.preventDefault();
    }, { capture: true, passive: false });

    document.addEventListener('touchend', function (ev) {
      if (!tracking) return;
      tracking = false;
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
      if (dist < 40) return;

      ev.preventDefault();

      // Vom linken Rand nach rechts = Zurück
      if (sx < 30 && dx > 80 && adx > ady) { sendKey(KEYS.back); return; }

      // Schnelles Wischen gibt ein paar Schritte extra
      const fast = (Date.now() - st) < 200 ? 1.5 : 1;
      const steps = Math.min(8, Math.max(1, Math.round(dist / CONFIG.swipeStepPx * fast)));

      if (adx > ady) sendKeys(dx < 0 ? KEYS.right : KEYS.left, steps);
      else sendKeys(dy < 0 ? KEYS.down : KEYS.up, steps);
    }, { capture: true, passive: false });
  }

  // ------------------------------------------------------------
  // Kleine Oberfläche: Vollbild-Knopf und Hinweis-Einblendung
  // ------------------------------------------------------------
  let backBtn = null;
  let btn = null;
  let hideTimer = null;
  let toastEl = null;

  // Knopf ist immer leicht sichtbar und wird beim Tippen kurz heller
  function showButton() {
    if (!btn) return;
    btn.style.opacity = '0.95';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { btn.style.opacity = '0.5'; }, 3000);
  }

  function toast(text, ms) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.style.opacity = '0'; }, ms || 2500);
  }

  let lastPress = 0;
  function onButton(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const now = Date.now();
    if (now - lastPress < 600) return; // touchend + click nicht doppelt zählen
    lastPress = now;
    if (isFs()) { autoFs = false; exitFs(); toast('Vollbild aus'); }
    else { autoFs = true; enterFs(true); }
    showButton();
  }

  function buildUi() {
    const root = document.documentElement;

    if (CONFIG.fullscreenButton && !btn) {
      btn = document.createElement('div');
      btn.id = 'yttv-fs-btn';
      btn.textContent = '⛶';
      btn.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'z-index:2147483647',
        'width:52px', 'height:52px', 'border-radius:26px',
        'background:rgba(0,0,0,0.7)', 'color:#fff', 'font-size:28px',
        'border:2px solid rgba(255,255,255,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'opacity:0.5', 'transition:opacity .3s', '-webkit-user-select:none',
        'user-select:none', 'cursor:pointer', 'pointer-events:auto',
      ].join(';');
      btn.addEventListener('touchend', onButton, true);
      btn.addEventListener('click', onButton, true);
    }

    if (CONFIG.backButton && !backBtn) {
      backBtn = document.createElement('div');
      backBtn.id = 'yttv-back-btn';
      backBtn.textContent = '←';
      backBtn.style.cssText = [
        'position:fixed', 'top:16px', 'left:16px', 'z-index:2147483647',
        'width:52px', 'height:52px', 'border-radius:26px',
        'background:rgba(0,0,0,0.7)', 'color:#fff', 'font-size:28px',
        'border:2px solid rgba(255,255,255,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'opacity:0.5', '-webkit-user-select:none', 'user-select:none',
        'cursor:pointer', 'pointer-events:auto',
      ].join(';');
      let lastBack = 0;
      const onBack = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const now = Date.now();
        if (now - lastBack < 600) return;
        lastBack = now;
        sendKey(KEYS.back);
      };
      backBtn.addEventListener('touchend', onBack, true);
      backBtn.addEventListener('click', onBack, true);
    }
    if (backBtn && !backBtn.isConnected) root.appendChild(backBtn);

    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = [
        'position:fixed', 'bottom:40px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:2147483647', 'padding:10px 18px', 'border-radius:20px',
        'background:rgba(0,0,0,0.8)', 'color:#fff', 'font:16px -apple-system,sans-serif',
        'opacity:0', 'transition:opacity .3s', 'pointer-events:none', 'text-align:center',
      ].join(';');
    }

    // Direkt an <html> hängen: Die TV-Oberfläche baut <body> teilweise neu
    // auf und würde den Knopf sonst wieder entfernen.
    if (btn && !btn.isConnected) root.appendChild(btn);
    if (!toastEl.isConnected) root.appendChild(toastEl);
  }

  function start() {
    buildUi();
    showButton();
    toast('✓ TV-Skript aktiv', 3500);
    // Falls die Seite den Knopf entfernt: jede Sekunde wieder einfügen
    setInterval(buildUi, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
