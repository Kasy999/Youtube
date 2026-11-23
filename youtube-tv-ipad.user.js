// ==UserScript==
// @name         YouTube TV iPad - Werbefrei und Vollbild
// @namespace    yt-tv-ipad
// @version      1.8.1
// @description  Entfernt Werbung in der YouTube-TV-Oberflaeche, SponsorBlock, Touch-Steuerung, Vollbild und volle Videoqualitaet fuer das iPad.
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
    quality: 'max',                // Videoqualität:
                                   // 'max'    = höchste verfügbare Stufe
                                   // 'hd2160' = höchstens 4K, 'hd1440' = 1440p,
                                   // 'hd1080' = 1080p, 'hd720' = 720p
                                   // false    = YouTube entscheiden lassen
    spoofScreen: true,             // dem Player einen 4K-Bildschirm melden,
                                   // damit er hohe Stufen überhaupt anbietet
    fullscreen: true,              // Seite beim Tippen ins Vollbild schalten
    touchNav: true,                // Wischen = Pfeiltasten wie auf der Fernbedienung
    swipeStepPx: 110,              // so viele Pixel Wischen = ein Schritt
    tapAsEnter: false,             // true, falls Antippen nichts auswählt
    longPressMs: 600,              // so lange drücken, bis die Knöpfe erscheinen
    hideAfterMs: 2000,             // Knöpfe verschwinden nach dieser Zeit wieder
    search: true,                  // eigenes Suchfeld mit iPad-Tastatur
    autoSearchField: true,         // Suchfeld automatisch auf der Suchseite zeigen
    searchMode: 'url',             // 'url' = Suchergebnisse direkt öffnen,
                                   // 'keys' = Text in die TV-Suche „eintippen"
    fillMode: 'cover',             // Anpassung an den Bildschirm (ohne schwarze Balken):
                                   // 'cover'   = füllt alles, Ränder werden leicht abgeschnitten
                                   // 'stretch' = füllt alles, Bild wird leicht verzerrt
                                   // 'contain' = Original mit schwarzen Balken
                                   // Umschalten auch per Knopf ⤢ (wird gemerkt)
  };

  // ------------------------------------------------------------
  // 1) WERBEBLOCKER
  // YouTube schickt Werbung als Teil der JSON-Antworten mit.
  // Wir entfernen diese Teile, bevor die Seite sie verarbeitet
  // (gleiches Prinzip wie bei TizenTube).
  // Hier wird außerdem die Bitraten-Grenze für den Player entfernt
  // (siehe 1b).
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
        if (CONFIG.adblock && isAdItem(obj[i])) obj.splice(i, 1);
        else clean(obj[i], depth + 1);
      }
      return obj;
    }
    if (CONFIG.adblock) {
      for (const k of AD_KEYS) if (k in obj) delete obj[k];
    }
    // Obergrenze für die Bitrate entfernen → höhere Stufen erlaubt
    if (CONFIG.quality && obj.streamSelectionConfig && typeof obj.streamSelectionConfig === 'object') {
      delete obj.streamSelectionConfig.maxBitrate;
    }
    for (const k in obj) {
      const v = obj[k];
      if (v && typeof v === 'object') clean(v, depth + 1);
    }
    return obj;
  }

  function looksLikeYouTube(r) {
    return r && typeof r === 'object' && !Array.isArray(r) &&
      ('responseContext' in r || 'playerResponse' in r || 'adPlacements' in r ||
       'playerAds' in r || 'playerConfig' in r || 'streamingData' in r);
  }

  if (CONFIG.adblock || CONFIG.quality) {
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
  // 1b) VOLLE VIDEOQUALITÄT FREISCHALTEN
  // Der TV-Player begrenzt auf dem iPad auf 720p, weil er
  //   - die Bildschirmgröße abfragt (iPad ist „zu klein"),
  //   - beim Browser nachfragt, ob 1080p+ abspielbar ist (mit
  //     Zusatzangaben wie width=1920, die Safari nicht versteht),
  //   - und Safari bei manchen Stufen „nicht flüssig" meldet.
  // Wir beantworten diese Fragen passend und stellen danach die
  // gewünschte Stufe direkt am Player ein.
  // ------------------------------------------------------------
  const QUALITY_ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const QUALITY_NAMES = {
    highres: '8K', hd2880: '5K', hd2160: '4K', hd1440: '1440p', hd1080: '1080p',
    hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p',
  };

  if (CONFIG.quality) {
    // a) Großen Bildschirm melden
    if (CONFIG.spoofScreen) {
      const W = 3840, H = 2160;
      const fake = { width: W, height: H, availWidth: W, availHeight: H };
      Object.keys(fake).forEach(function (k) {
        try {
          Object.defineProperty(Screen.prototype, k, {
            get: function () { return fake[k]; }, configurable: true,
          });
        } catch (e) { /* ignorieren */ }
      });
    }

    // b) Formatabfragen ohne Auflösungs-/Bitrate-Angaben an Safari weiterreichen.
    //    Der Codec selbst wird weiterhin echt geprüft – wir behaupten also
    //    nichts, was das iPad nicht abspielen kann (HDR-Angabe „eotf" bleibt).
    const STRIP = /^\s*(width|height|framerate|bitrate|decode-to-texture|cryptoblockformat)\s*=/i;
    function stripParams(type) {
      return String(type).split(';').filter(function (p) { return !STRIP.test(p); }).join(';');
    }
    [window.MediaSource, window.ManagedMediaSource, window.WebKitMediaSource].forEach(function (MS) {
      if (!MS || typeof MS.isTypeSupported !== 'function' || MS.isTypeSupported._yttv) return;
      const orig = MS.isTypeSupported.bind(MS);
      const patched = function (type) {
        try { return orig(stripParams(type)); } catch (e) { return false; }
      };
      patched._yttv = true;
      try { MS.isTypeSupported = patched; } catch (e) { /* ignorieren */ }
    });

    // c) „Unterstützt, aber nicht flüssig" → als flüssig melden
    const mc = navigator.mediaCapabilities;
    if (mc && typeof mc.decodingInfo === 'function') {
      const origDI = mc.decodingInfo.bind(mc);
      try {
        mc.decodingInfo = function (cfg) {
          return origDI(cfg).then(function (res) {
            if (!res || !res.supported) return res;
            return { supported: true, smooth: true, powerEfficient: true, configuration: res.configuration };
          });
        };
      } catch (e) { /* ignorieren */ }
    }
  }

  // d) Gewünschte Stufe am Player einstellen
  let qualityToastFor = null;

  function getPlayer() {
    const list = document.querySelectorAll('#movie_player, .html5-video-player');
    for (let i = 0; i < list.length; i++) {
      if (typeof list[i].getAvailableQualityLevels === 'function') return list[i];
    }
    return null;
  }

  function pickQuality(levels) {
    const known = levels.filter(function (l) { return QUALITY_ORDER.indexOf(l) !== -1; });
    if (!known.length) return null;
    known.sort(function (a, b) { return QUALITY_ORDER.indexOf(a) - QUALITY_ORDER.indexOf(b); });
    if (CONFIG.quality === 'max') return known[0];
    const limit = QUALITY_ORDER.indexOf(CONFIG.quality);
    if (limit === -1) return known[0];
    for (const l of known) if (QUALITY_ORDER.indexOf(l) >= limit) return l;
    return known[known.length - 1];
  }

  function enforceQuality() {
    const id = getVideoId();
    if (!id) { qualityToastFor = null; return; }
    const p = getPlayer();
    if (!p) return;
    let levels;
    try { levels = p.getAvailableQualityLevels(); } catch (e) { return; }
    if (!levels || !levels.length) return;
    const q = pickQuality(levels);
    if (!q) return;
    let now = null;
    try { now = p.getPlaybackQuality(); } catch (e) { /* ignorieren */ }
    if (now !== q) {
      try { if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(q, q); } catch (e) { /* ignorieren */ }
      try { if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(q); } catch (e) { /* ignorieren */ }
    }
    if (qualityToastFor !== id) {
      qualityToastFor = id;
      toast('Qualität: ' + (QUALITY_NAMES[q] || q));
    }
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

  // Datenschutz: Statt der Video-ID schicken wir nur die ersten
  // 4 Zeichen ihres SHA-256-Hashes. Der Server liefert dann die
  // Abschnitte vieler Videos, und wir suchen unseres selbst heraus.
  async function sha256Prefix(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hex = Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
    return hex.slice(0, 4);
  }

  async function loadSegments(id) {
    segments = [];
    try {
      const cats = '&categories=' + encodeURIComponent(JSON.stringify(CONFIG.sponsorCategories));
      let list = null;
      if (window.crypto && crypto.subtle) {
        const res = await fetch('https://sponsor.ajay.app/api/skipSegments/' + (await sha256Prefix(id)) + '?' + cats.slice(1));
        if (!res.ok) return; // 404 = keine Abschnitte
        const data = await res.json();
        const hit = Array.isArray(data) && data.find(function (v) { return v.videoID === id; });
        list = hit ? hit.segments : null;
      } else {
        // Ausweichweg, falls crypto.subtle fehlt
        const res = await fetch('https://sponsor.ajay.app/api/skipSegments?videoID=' + id + cats);
        if (!res.ok) return;
        list = await res.json();
      }
      if (id === currentId && Array.isArray(list)) {
        segments = list
          .filter(function (s) { return !s.actionType || s.actionType === 'skip'; })
          .map(function (s) { return s.segment; });
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
  const VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

  // Viewport so setzen, dass auch die Randbereiche genutzt werden.
  // Wird jede Sekunde geprüft, falls die Seite ihn überschreibt.
  function applyViewport() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      (document.head || document.documentElement).appendChild(vp);
    }
    if (vp.content !== VIEWPORT) vp.content = VIEWPORT;
  }

  function applyFillStyles() {
    applyViewport();
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
  }

  let wantFs = CONFIG.fullscreen;
  let exitingByButton = false;

  // Verlässt du das Vollbild per iPad-Geste oder ✕, soll es nicht
  // beim nächsten Antippen sofort wiederkommen. Über ⛶ wieder an.
  function onFsChange() {
    if (isFs()) return;
    if (!exitingByButton && wantFs) {
      wantFs = false;
      toast('Vollbild aus – lange drücken und ⛶ tippen zum Einschalten');
    }
    exitingByButton = false;
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

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
  // 3b) AN DIE BILDSCHIRMGRÖSSE ANPASSEN (keine schwarzen Balken)
  // Die TV-Oberfläche zeichnet sich als 16:9-Fläche („Bühne") und
  // setzt sie mittig mit Balken in den Bildschirm. Wir suchen diese
  // Fläche und skalieren die Seite so, dass sie den ganzen
  // Bildschirm füllt – passend zu iPad, iPhone, Hoch- und Querformat.
  // ------------------------------------------------------------
  const FILL_MODES = ['cover', 'stretch', 'contain'];
  const FILL_NAMES = { cover: 'Füllen (Ränder abgeschnitten)', stretch: 'Strecken', contain: 'Original mit Balken' };
  let fillMode = CONFIG.fillMode;
  try {
    const saved = localStorage.getItem('yttv-fill-mode');
    if (FILL_MODES.indexOf(saved) !== -1) fillMode = saved;
  } catch (e) { /* ignorieren */ }

  // aktuell von uns angewendete Transformation (zum Zurückrechnen)
  let cur = { tx: 0, ty: 0, sx: 1, sy: 1 };

  // Rechteck eines Elements OHNE unsere Skalierung
  function rawRect(el) {
    const r = el.getBoundingClientRect();
    return {
      left: (r.left - cur.tx) / cur.sx,
      top: (r.top - cur.ty) / cur.sy,
      width: r.width / cur.sx,
      height: r.height / cur.sy,
    };
  }

  // Die 16:9-Bühne der TV-Oberfläche finden
  function findStage(vw, vh) {
    const body = document.body;
    if (!body) return null;
    let best = null, bestArea = 0;
    (function walk(el, depth) {
      if (depth > 6) return;
      const kids = el.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.id && c.id.indexOf('yttv-') === 0) continue;
        const r = rawRect(c);
        if (r.width > 0 && r.height > 0) {
          const ar = r.width / r.height;
          const area = r.width * r.height;
          if (ar > 1.70 && ar < 1.85 && area > vw * vh * 0.35 && area > bestArea) {
            best = r; bestArea = area;
          }
        }
        walk(c, depth + 1);
      }
    })(body, 0);
    return best;
  }

  function setTransform(t) {
    const body = document.body;
    if (!body) return;
    const same = Math.abs(t.tx - cur.tx) < 0.5 && Math.abs(t.ty - cur.ty) < 0.5 &&
      Math.abs(t.sx - cur.sx) < 0.001 && Math.abs(t.sy - cur.sy) < 0.001;
    if (same && body.style.transform) return;
    cur = t;
    if (t.sx === 1 && t.sy === 1 && t.tx === 0 && t.ty === 0) {
      body.style.transform = '';
      return;
    }
    body.style.transformOrigin = '0 0';
    body.style.transform = 'translate(' + t.tx + 'px,' + t.ty + 'px) scale(' + t.sx + ',' + t.sy + ')';
  }

  function applyFill() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return;
    // Hat die Seite <body> ersetzt, ist unsere Skalierung weg –
    // dann darf rawRect() nicht mehr mit den alten Werten zurückrechnen.
    if (document.body && !document.body.style.transform) cur = { tx: 0, ty: 0, sx: 1, sy: 1 };
    // Hochformat (v. a. iPhone): Füllen würde fast alles abschneiden
    if (fillMode === 'contain' || vh > vw) { setTransform({ tx: 0, ty: 0, sx: 1, sy: 1 }); return; }

    const r = findStage(vw, vh);
    if (!r) { setTransform({ tx: 0, ty: 0, sx: 1, sy: 1 }); return; }
    // Bühne füllt den Bildschirm schon (Seitenverhältnis passt) → nichts tun
    if (Math.abs(r.width - vw) < 2 && Math.abs(r.height - vh) < 2) {
      setTransform({ tx: 0, ty: 0, sx: 1, sy: 1 }); return;
    }

    let sx, sy;
    if (fillMode === 'stretch') {
      sx = vw / r.width; sy = vh / r.height;
    } else {
      sx = sy = Math.max(vw / r.width, vh / r.height);
    }
    // Bühne mittig auf den Bildschirm legen
    const tx = (vw - sx * r.width) / 2 - sx * r.left;
    const ty = (vh - sy * r.height) / 2 - sy * r.top;
    setTransform({ tx: tx, ty: ty, sx: sx, sy: sy });
  }

  function cycleFillMode() {
    fillMode = FILL_MODES[(FILL_MODES.indexOf(fillMode) + 1) % FILL_MODES.length];
    try { localStorage.setItem('yttv-fill-mode', fillMode); } catch (e) { /* ignorieren */ }
    applyFill();
    toast('Anzeige: ' + FILL_NAMES[fillMode]);
  }

  window.addEventListener('resize', function () { setTimeout(applyFill, 100); });
  window.addEventListener('orientationchange', function () { setTimeout(applyFill, 300); });

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
  let searchBtn = null;
  let fillBtn = null;
  let toastEl = null;
  let hideTimer = null;

  function makeButton(id, label, side, offsetPx) {
    const b = document.createElement('div');
    b.id = id;
    b.textContent = label;
    b.style.cssText = [
      'position:fixed', 'top:calc(16px + env(safe-area-inset-top))',
      side + ':calc(' + (offsetPx || 16) + 'px + env(safe-area-inset-' + side + '))',
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
    [fsBtn, backBtn, searchBtn, fillBtn].forEach(function (b) {
      if (!b) return;
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
    });
    clearTimeout(hideTimer);
  }

  function hideControls() {
    [fsBtn, backBtn, searchBtn, fillBtn].forEach(function (b) {
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
    if (isFs()) { wantFs = false; exitingByButton = true; exitFs(); toast('Vollbild aus'); }
    else { wantFs = true; enterFs(true); }
  }

  function onBackButton() {
    sendKey(KEYS.back);
  }

  // ------------------------------------------------------------
  // 5b) SUCHFELD MIT iPAD-TASTATUR
  // Die TV-Suche hat nur eine Bildschirmtastatur für die
  // Fernbedienung. Wir legen ein echtes Textfeld darüber:
  //   - erscheint automatisch auf der Suchseite (oder über 🔍)
  //   - Eingabetaste/„Suchen" startet die Suche
  // ------------------------------------------------------------
  let searchBox = null;
  let searchInput = null;
  let searchDismissedFor = null;   // auf dieser Seite vom Nutzer geschlossen
  let lastSubmit = 0;

  function isSearchPage() {
    return /^#\/search/.test(location.hash);
  }

  function buildSearchBox() {
    const box = document.createElement('form');
    box.id = 'yttv-search-box';
    box.setAttribute('action', '#');
    box.style.cssText = [
      'position:fixed', 'top:calc(16px + env(safe-area-inset-top))',
      'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'display:none', 'align-items:center', 'gap:8px',
      'width:min(640px, calc(100vw - 200px))', 'padding:8px',
      'background:rgba(20,20,20,0.92)', 'border-radius:16px',
      'border:2px solid rgba(255,255,255,0.5)',
      'box-shadow:0 6px 24px rgba(0,0,0,0.6)',
    ].join(';');

    const input = document.createElement('input');
    input.id = 'yttv-search-input';
    input.type = 'search';
    input.placeholder = 'YouTube durchsuchen …';
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.style.cssText = [
      'flex:1', 'min-width:0', 'height:48px', 'padding:0 14px',
      'font:20px -apple-system,sans-serif', 'color:#fff',
      'background:#333', 'border:none', 'border-radius:10px', 'outline:none',
      '-webkit-user-select:text', 'user-select:text', '-webkit-touch-callout:default',
      '-webkit-appearance:none', 'appearance:none',
    ].join(';');

    const go = document.createElement('button');
    go.type = 'submit';
    go.textContent = 'Suchen';
    go.style.cssText = [
      'height:48px', 'padding:0 16px', 'font:18px -apple-system,sans-serif',
      'color:#fff', 'background:#c00', 'border:none', 'border-radius:10px',
    ].join(';');

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '✕';
    close.style.cssText = [
      'height:48px', 'width:48px', 'font:20px -apple-system,sans-serif',
      'color:#fff', 'background:#555', 'border:none', 'border-radius:10px',
    ].join(';');
    close.addEventListener('click', function (ev) {
      ev.preventDefault();
      searchDismissedFor = location.hash;
      closeSearch();
    });

    box.addEventListener('submit', function (ev) {
      ev.preventDefault();
      submitSearch();
    });

    box.appendChild(input);
    box.appendChild(go);
    box.appendChild(close);
    searchBox = box;
    searchInput = input;
    return box;
  }

  function openSearch(focus) {
    if (!searchBox) return;
    searchBox.style.display = 'flex';
    if (focus) {
      // Muss direkt im Tipp-Ereignis passieren, sonst zeigt iOS keine Tastatur
      try { searchInput.focus(); } catch (e) { /* ignorieren */ }
    }
  }

  function closeSearch() {
    if (!searchBox) return;
    try { searchInput.blur(); } catch (e) { /* ignorieren */ }
    searchBox.style.display = 'none';
  }

  function isSearchOpen() {
    return !!(searchBox && searchBox.style.display !== 'none');
  }

  function sendChar(ch) {
    const target = document.activeElement && document.activeElement !== searchInput
      ? document.activeElement : (document.body || document.documentElement);
    const upper = ch.toUpperCase();
    const keyCode = ch === ' ' ? 32 : (/[A-Z0-9]/.test(upper) ? upper.charCodeAt(0) : ch.charCodeAt(0));
    ['keydown', 'keypress', 'keyup'].forEach(function (type) {
      const ev = new KeyboardEvent(type, { key: ch, bubbles: true, cancelable: true });
      try {
        Object.defineProperty(ev, 'keyCode', { get: function () { return type === 'keypress' ? ch.charCodeAt(0) : keyCode; } });
        Object.defineProperty(ev, 'which', { get: function () { return type === 'keypress' ? ch.charCodeAt(0) : keyCode; } });
        Object.defineProperty(ev, 'charCode', { get: function () { return type === 'keypress' ? ch.charCodeAt(0) : 0; } });
      } catch (e) { /* ignorieren */ }
      target.dispatchEvent(ev);
    });
  }

  function typeIntoTv(text) {
    const chars = Array.from(text);
    chars.forEach(function (ch, i) {
      setTimeout(function () { sendChar(ch); }, i * 50);
    });
    setTimeout(function () { sendKey(KEYS.enter); }, chars.length * 50 + 150);
  }

  function submitSearch() {
    const now = Date.now();
    if (now - lastSubmit < 800) return; // Enter + submit nicht doppelt
    lastSubmit = now;
    const q = (searchInput.value || '').trim();
    if (!q) return;
    closeSearch();
    searchInput.value = '';
    if (CONFIG.searchMode === 'keys') {
      typeIntoTv(q);
    } else {
      searchDismissedFor = '#/search?q=' + encodeURIComponent(q);
      location.hash = searchDismissedFor;
    }
    toast('Suche: ' + q);
  }

  function onSearchButton() {
    if (isSearchOpen()) closeSearch();
    else openSearch(true);
  }

  // Tastendrücke im Suchfeld NICHT an die TV-Oberfläche weitergeben,
  // sonst springt dort beim Tippen die Auswahl herum.
  // (Läuft vor allen Listenern der Seite, weil das Skript zuerst startet.)
  ['keydown', 'keypress', 'keyup'].forEach(function (type) {
    window.addEventListener(type, function (ev) {
      if (!ev.isTrusted || !searchInput || ev.target !== searchInput) return;
      ev.stopImmediatePropagation();
      if (type === 'keydown' && (ev.key === 'Enter' || ev.keyCode === 13)) {
        ev.preventDefault();
        submitSearch();
      } else if (type === 'keydown' && (ev.key === 'Escape' || ev.keyCode === 27)) {
        ev.preventDefault();
        searchDismissedFor = location.hash;
        closeSearch();
      }
    }, true);
  });

  // Suchfeld automatisch auf der Suchseite zeigen
  function syncSearchWithPage() {
    if (!CONFIG.search || !searchBox) return;
    if (isSearchPage()) {
      if (CONFIG.autoSearchField && !isSearchOpen() && searchDismissedFor !== location.hash) {
        openSearch(false); // Tastatur kommt beim Antippen des Felds
      }
    } else if (isSearchOpen() && document.activeElement !== searchInput) {
      closeSearch();
      searchDismissedFor = null;
    }
  }
  window.addEventListener('hashchange', syncSearchWithPage);

  function buildUi() {
    const root = document.documentElement;
    applyFillStyles();

    if (CONFIG.search && !searchBtn) {
      searchBtn = makeButton('yttv-search-btn', '🔍', 'right', 88);
      const h = buttonHandler(onSearchButton);
      searchBtn.addEventListener('touchend', h, true);
      searchBtn.addEventListener('click', h, true);
    }
    if (CONFIG.search && !searchBox) buildSearchBox();
    if (!fillBtn) {
      fillBtn = makeButton('yttv-fill-btn', '⤢', 'right', CONFIG.search ? 160 : 88);
      const h = buttonHandler(cycleFillMode);
      fillBtn.addEventListener('touchend', h, true);
      fillBtn.addEventListener('click', h, true);
    }
    if (!fillBtn.isConnected) root.appendChild(fillBtn);
    [searchBtn, searchBox].forEach(function (el) {
      if (el && !el.isConnected) root.appendChild(el);
    });
    syncSearchWithPage();

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
    return el && el.closest && el.closest('#yttv-fs-btn, #yttv-back-btn, #yttv-search-btn, #yttv-fill-btn, #yttv-search-box');
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
  document.addEventListener('contextmenu', function (ev) {
    if (isOwnUi(ev.target)) return; // im Suchfeld Einfügen-Menü erlauben
    ev.preventDefault();
  }, true);

  // ------------------------------------------------------------
  // START
  // ------------------------------------------------------------
  function start() {
    buildUi();
    toast('✓ TV-Skript aktiv – lange drücken für Knöpfe (← ⤢ 🔍 ⛶)', 3500);
    // Falls die Seite unsere Elemente entfernt: jede Sekunde wieder einfügen
    setInterval(buildUi, 1000);
    // Anpassung an die Bildschirmgröße regelmäßig prüfen (Seite lädt nach)
    applyFill();
    setInterval(applyFill, 1500);
    // Gewünschte Videoqualität regelmäßig durchsetzen
    if (CONFIG.quality) setInterval(enforceQuality, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
