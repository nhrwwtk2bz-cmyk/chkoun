(() => {
'use strict';
/* ============================================================ helpers */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  if (a) for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return e;
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
const hashStr = (s) => { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; };
const detPick = (arr, seed) => arr[hashStr(String(seed)) % arr.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================ texts */
const ERR = {
  need_players: 'Lazem 3 le3bin 3al a9al bech nebdew 👥', name_taken: 'Had el esm mawjoud 9bal, ekhtar o5ra 😅',
  room_full: 'El partie 3amra (12 max) 🚫', no_room: 'Code ghalet wala el partie salet 🤷', need_name: 'Ekteb esmek 3la khatrek ✍️',
  slow_down: 'Mhal 3lina chwaya... 🐢', already_voted: 'Dejà votit 🔒', self_vote: 'Ma tnajemch tvoti 3la rou7ek 😂',
  bad_token: 'Ta3tilet el session, 3awed edkhol', not_allowed: 'Hadhi ghir lel host 👑', not_voting: 'El vote safa 3la el round hedha',
  need_category: 'Lazem tkhalli categorie wa7da 3al a9al', no_votes: 'Mazel ma7ad vota 🤨', offline: 'Ma fama ch internet 📶', busy: 'El server mazdoum, 3awed ba3d chwaya',
};
const REACT = {
  one: ['El groupe kol 9al: houwa! 🎯', 'Ma fama 7ata chek 😂', 'Hadha 3andou wejh el mowdou3 💀', '3arfouh el kol 👀', 'El 7a9i9a mor-ra… 🍋', 'Sa7it! El ness ma tkadhebch 🤝', 'Ya 3ayb 3lik w 3lina! 😭'],
  tie: ['Ta3adol 7a9i9i! Kol we7ed 3andou 7a9 🤝', 'Ma7ad bech yemchi bkhir 😈', 'El groupe mfara9 fi rayou 🤯'],
  none: ['Ma7ad vota? Akid fama mochkla 🤨'],
  all: ['Ijma3!! Kol we7ed 9al nafs el esm 😱', 'Unanimité! Ma fama ch 9a3ed 🔥'],
};
const SPECIAL = {
  double: '⭐ Round DOUBLE! El li yefouz ykhou 2 points',
  crowd: '🤝 Ra2i el 3am: ken khtart nafs el we7ed elli yefouz, tekseb +1 bonus',
};
const CAT_EMOJI = {};
let CAT_NAME = {};

/* ============================================================ state */
const S = {
  info: null, session: null, view: null, prev: null, screen: null, es: null, lastMsg: 0, conn: 'idle',
  key: null, updater: null, timers: [], selected: null, busy: false, closing: false,
  muted: !!store.get('ckw.muted'), profile: store.get('ckw.profile') || { name: '', avatar: null },
};
const clearTimers = () => { S.timers.forEach(clearTimeout); S.timers = []; };
const later = (fn, ms) => { const t = setTimeout(fn, ms); S.timers.push(t); return t; };
const P = (id) => (S.view ? S.view.players.find((p) => p.id === id) : null);

/* ============================================================ sound + fx */
const Sfx = (() => {
  let ctx;
  const ac = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx; };
  function tone(f, t0, d, type = 'sine', vol = .16, slide) {
    const c = ac(); if (!c || S.muted) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + .05);
  }
  function noise(t0, d, vol = .1, f = 900) {
    const c = ac(); if (!c || S.muted) return;
    const len = Math.max(1, Math.floor(c.sampleRate * d)), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(), flt = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + t0;
    s.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = f; g.gain.value = vol;
    s.connect(flt).connect(g).connect(c.destination); s.start(t);
  }
  return {
    unlock: ac,
    pop() { tone(520, 0, .09, 'triangle', .2, 900); },
    lock() { tone(330, 0, .08, 'square', .08); tone(660, .09, .14, 'square', .08); },
    join() { tone(660, 0, .08); tone(990, .08, .12); },
    drum() { for (let i = 0; i < 24; i++) noise(i * .088 + (i * i) * .0004, .07, .05 + i * .004, 180 + i * 12); },
    boom() { tone(120, 0, .6, 'sine', .45, 38); noise(0, .35, .22, 260); },
    win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * .1, .4, 'triangle', .17)); },
    tie() { tone(392, 0, .25, 'sawtooth', .1); tone(392, .28, .4, 'sawtooth', .1); },
    fin() { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * .13, .45, 'triangle', .17)); },
    tick() { tone(900, 0, .04, 'square', .05); },
  };
})();
const vibe = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

const Confetti = (() => {
  let parts = [], raf = 0;
  const colors = ['#ff2e88', '#ffd23f', '#22e1ff', '#3dff9a', '#8b5cf6', '#ffffff'];
  function loop() {
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => { p.vy += .18; p.x += p.vx; p.y += p.vy; p.vx *= .995; p.r += p.vr; p.life--; });
    parts = parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
    parts.forEach((p) => { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.min(1, p.life / 40); ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); ctx.restore(); });
    raf = parts.length ? requestAnimationFrame(loop) : 0;
    if (!parts.length) ctx.clearRect(0, 0, cv.width, cv.height);
  }
  return {
    burst(n = 150) {
      const cv = $('#confetti'), dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      for (let i = 0; i < n; i++) {
        const left = i % 2 === 0;
        parts.push({ x: (left ? .1 : .9) * cv.width, y: cv.height * .75, vx: (left ? 1 : -1) * (4 + Math.random() * 9) * dpr, vy: -(12 + Math.random() * 14) * dpr,
          s: (6 + Math.random() * 8) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[i % colors.length], life: 110 + Math.random() * 70 });
      }
      if (!raf) raf = requestAnimationFrame(loop);
    },
  };
})();

function toast(msg, err) {
  const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), 3200);
}

/* ============================================================ network */
async function api(path, body) {
  let r;
  try { r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch (_) { throw Object.assign(new Error('offline'), { code: 'offline', status: 0 }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'error'), { code: j.error || 'error', status: r.status });
  return j;
}
async function act(type, extra = {}) {
  if (!S.session) return false;
  try { await api('/api/act', { code: S.session.code, token: S.session.token, type, ...extra }); refresh(); return true; }
  catch (e) {
    toast(ERR[e.code] || 'Mochkla ta9niya 😵', true);
    if (e.status === 401 || e.status === 404) dropSession();
    return false;
  }
}
async function refresh() { // resync snapshot (also used after returning from background)
  const code = S.session ? S.session.code : S.screen; if (!code) return;
  try {
    const q = S.session ? `code=${code}&token=${S.session.token}` : `code=${code}`;
    const r = await fetch('/api/state?' + q, { cache: 'no-store' });
    if (r.status === 404) return gone('El partie salet 🏁');
    if (r.ok) onState(await r.json());
  } catch (_) {}
}

function connect() {
  disconnect();
  const code = S.session ? S.session.code : S.screen; if (!code) return;
  const url = S.session ? `/api/events?code=${code}&token=${S.session.token}` : `/api/events?code=${code}&screen=1`;
  const es = new EventSource(url); S.es = es; S.lastMsg = Date.now();
  es.addEventListener('state', (e) => { S.lastMsg = Date.now(); setConn('ok'); onState(JSON.parse(e.data)); });
  es.addEventListener('hb', () => { S.lastMsg = Date.now(); setConn('ok'); });
  es.addEventListener('kicked', () => { gone('El host 5arajek men el partie 😬'); });
  es.addEventListener('left', () => {});
  es.onerror = async () => {
    setConn('retry');
    if (es.readyState === EventSource.CLOSED && S.es === es) { // server refused (room gone / token invalid)
      try {
        const q = S.session ? `code=${code}&token=${S.session.token}` : `code=${code}`;
        const r = await fetch('/api/state?' + q, { cache: 'no-store' });
        if (r.status === 404) return gone('El partie salet 🏁');
        if (r.ok && S.session) { const v = await r.json(); if (!v.you) return gone('Ta3tilet el session — edkhol men jdid'); }
      } catch (_) {}
      setTimeout(() => { if (S.es === es) connect(); }, 1500);
    }
  };
}
function disconnect() { if (S.es) { try { S.es.close(); } catch (_) {} S.es = null; } }
function setConn(c) { S.conn = c; $('#conn').classList.toggle('retry', c !== 'ok'); $('#netbar').hidden = c === 'ok'; }

function dropSession() { store.del('ckw.session'); S.session = null; }
function gone(msg) {
  disconnect(); dropSession(); S.view = null; S.prev = null; S.screen = null; document.body.classList.remove('screen');
  history.replaceState(null, '', '/'); render(); if (msg) toast(msg, true);
}
async function enter(code, token, playerId) {
  S.session = { code, token, playerId }; store.set('ckw.session', S.session);
  history.replaceState(null, '', '/'); S.view = null; connect();
}

// keep-alive ping + stale-stream watchdog + resume after background
setInterval(() => { if (S.session && !document.hidden) api('/api/act', { code: S.session.code, token: S.session.token, type: 'ping' }).catch((e) => { if (e.status === 401 || e.status === 404) gone('Ta3tilet el session'); }); }, 10000);
setInterval(() => { if ((S.session || S.screen) && !document.hidden && Date.now() - S.lastMsg > 40000) { setConn('retry'); connect(); } }, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !(S.session || S.screen)) return;
  if (!S.es || S.es.readyState === EventSource.CLOSED || Date.now() - S.lastMsg > 20000) connect();
  refresh();
});
window.addEventListener('online', () => { if (S.session || S.screen) { connect(); refresh(); } });

function onState(view) {
  if (S.view && S.view.code === view.code && view.v < S.view.v) return; // stale snapshot
  S.prev = S.view; S.view = view;
  if (S.prev && S.prev.phase === 'lobby' && view.phase === 'lobby' && view.players.length > S.prev.players.length) Sfx.join();
  render();
}

/* ============================================================ rendering core */
function show(key, builder) {
  if (S.key === key) return;
  clearTimers(); S.key = key;
  const app = $('#app'); app.replaceChildren();
  const out = builder(); app.append(out.el); S.updater = out.update || null;
  window.scrollTo(0, 0);
}
function joinBase() {
  const lan = S.info && S.info.lan && S.info.lan[0];
  if (S.info && S.info.publicUrl) return S.info.publicUrl.replace(/\/$/, '');
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname) && lan) return lan;
  return location.origin;
}
const joinUrl = (code) => `${joinBase()}/?r=${code}`;
const screenUrl = (code) => `${joinBase()}/?screen=${code}`;

function renderBar() {
  const v = S.view, bar = $('#bar');
  bar.hidden = !v;
  if (!v) return;
  $('#codeChip').textContent = v.code;
  $('#leaveBtn').hidden = !S.session;
  $('#muteBtn').textContent = S.muted ? '🔇' : '🔊';
}

function render() {
  document.body.classList.toggle('screen', !!S.screen);
  renderBar();
  const v = S.view;
  if (!v) {
    if (S.session || S.screen) show('loading', () => ({ el: h('div', { class: 'screen', style: 'justify-content:center' }, h('div', { class: 'card wait' }, h('div', { class: 'big' }, '🎲'), h('h3', null, 'Nconnectiw…'))) }));
    else show('home', buildHome);
    return;
  }
  switch (v.phase) {
    case 'lobby': show('lobby', buildLobby); break;
    case 'voting': show(`vote:${v.round.n}:${v.round.text}`, buildVoting); break;
    case 'reveal': show(`reveal:${v.round.n}:${v.round.text}`, buildReveal); break;
    case 'leaderboard': show(`lb:${v.round.n}`, buildLeaderboard); break;
    case 'final': show('final', buildFinal); break;
    default: break;
  }
  if (S.updater) S.updater(v);
}

/* ============================================================ HOME */
function buildHome() {
  const params = new URLSearchParams(location.search);
  const prefill = (params.get('r') || '').toUpperCase().slice(0, 6);
  let avatar = S.profile.avatar || S.info.avatars[Math.floor(Math.random() * S.info.avatars.length)];
  const name = h('input', { class: 'inp', placeholder: 'Esmek (max 14)', maxlength: 14, value: S.profile.name || '', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done' });
  const grid = h('div', { class: 'avatars' }, S.info.avatars.map((a) => h('button', { type: 'button', class: 'av' + (a === avatar ? ' on' : ''),
    onclick: () => { avatar = a; [...grid.children].forEach((c) => c.classList.toggle('on', c.textContent === a)); Sfx.unlock(); Sfx.pop(); } }, a)));
  const code = h('input', { class: 'inp code', placeholder: 'CODE', maxlength: 6, value: prefill, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'go' });
  code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const need = () => {
    const n = name.value.trim();
    if (!n) { name.classList.remove('shake'); void name.offsetWidth; name.classList.add('shake'); name.focus(); toast(ERR.need_name, true); return null; }
    S.profile = { name: n, avatar }; store.set('ckw.profile', S.profile); return n;
  };
  const guard = async (fn) => { if (S.busy) return; S.busy = true; try { await fn(); } catch (e) { toast(ERR[e.code] || 'Mochkla ta9niya 😵', true); } finally { S.busy = false; } };
  const create = h('button', { class: 'btn', type: 'button', onclick: () => { Sfx.unlock(); guard(async () => { const n = need(); if (!n) return; const r = await api('/api/create', { name: n, avatar }); await enter(r.code, r.token, r.playerId); }); } }, '🎉 Sna3 partie jdida');
  const join = h('button', { class: `btn ${prefill ? '' : 'cyan'}`, type: 'button', onclick: () => { Sfx.unlock(); guard(async () => {
    const n = need(); if (!n) return;
    if (code.value.length !== 6) { code.classList.remove('shake'); void code.offsetWidth; code.classList.add('shake'); toast('Code lazem ykoun 6 7orouf', true); return; }
    const r = await api('/api/join', { code: code.value, name: n, avatar }); await enter(r.code, r.token, r.playerId); }); } }, '🚪 Edkhol lel partie');
  if (prefill) { create.className = 'btn ghost'; create.textContent = '🎉 Wala sna3 partie jdida'; }
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join.click(); });

  const scr = h('input', { class: 'inp code', placeholder: 'CODE', maxlength: 6, autocapitalize: 'characters', style: 'font-size:18px;padding:10px' });
  scr.addEventListener('input', () => { scr.value = scr.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const scrBox = h('div', { class: 'card', hidden: true }, h('p', { class: 'hint', style: 'margin-bottom:10px' }, 'Fta7 hedha 3la laptop wala tablette bech yetfarjou el kol 3al écran el kbir.'),
    h('div', { class: 'row' }, scr, h('button', { class: 'btn ghost sm', style: 'width:auto', type: 'button', onclick: () => { if (scr.value.length === 6) location.href = `/?screen=${scr.value}`; else toast('Code lazem ykoun 6 7orouf', true); } }, 'Fta7 📺')));

  const el = h('div', { class: 'screen' },
    h('div', { class: 'logo' }, h('span', { class: 'emo' }, '🎉'), h('span', { class: 't1' }, 'Chkoun'), h('span', { class: 't2' }, 'Akther ', h('b', null, 'Wa7ed?')),
      h('p', { class: 'sub' }, 'El le3ba lel s7ab. Sawwet b secret, w chouf el 7a9i9a m3a b3adhkom 😈')),
    h('div', { class: 'card' }, h('label', { class: 'lbl' }, 'Esmek'), name, h('label', { class: 'lbl', style: 'margin-top:14px' }, 'Ekhtar avatar'), grid),
    prefill ? h('div', { class: 'card' }, h('label', { class: 'lbl' }, 'Code el partie'), code, h('div', { style: 'height:12px' }), join) : null,
    prefill ? null : create,
    prefill ? create : h('div', { class: 'sep' }, 'wala'),
    prefill ? null : h('div', { class: 'card' }, h('label', { class: 'lbl' }, 'Andek code?'), code, h('div', { style: 'height:12px' }), join),
    h('button', { class: 'link', type: 'button', style: 'align-self:center;margin-top:6px', onclick: () => { scrBox.hidden = !scrBox.hidden; } }, '📺 Mode écran kbir (TV / laptop)'),
    scrBox,
    h('p', { class: 'hint' }, '3-12 le3bin • kol we7ed 3al téléphone mta3ou • vote anonyme 🔒'));
  return { el };
}

/* ============================================================ LOBBY */
function buildLobby() {
  const v0 = S.view, isScreen = !!S.screen;
  const qrCanvas = h('canvas', { width: 10, height: 10 });
  const codeEl = h('div', { class: 'roomcode' }, v0.code);
  const link = h('p', { class: 'hint', style: 'margin-top:10px;word-break:break-all' }, joinUrl(v0.code).replace(/^https?:\/\//, ''));
  try { QR.draw(qrCanvas, joinUrl(v0.code), 520); } catch (_) { qrCanvas.replaceWith(h('div', { class: 'hint' }, 'QR ma tkhdemch — est3mel el code')); }
  const share = h('div', { class: 'row', style: 'margin-top:12px' },
    h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => { const u = joinUrl(v0.code); const msg = `Ta3al le3ab m3aya "Chkoun Akther Wa7ed?" 🎉 Code: ${v0.code}`; if (navigator.share) { try { await navigator.share({ title: 'Chkoun Akther Wa7ed?', text: msg, url: u }); return; } catch (_) { return; } } copy(u); } }, '📤 Cherki el lien'),
    isScreen ? null : h('button', { class: 'btn ghost sm', type: 'button', onclick: () => window.open(screenUrl(v0.code), '_blank') }, '📺 Écran kbir'));
  const joinCard = h('div', { class: 'card center' }, h('label', { class: 'lbl' }, 'Code el partie'), codeEl, h('div', { class: 'qr' }, qrCanvas), link, isScreen ? null : share);

  const playersBox = h('div', { class: 'players' });
  const countEl = h('label', { class: 'lbl' });
  const settingsBox = h('div', { class: 'card', style: 'display:flex;flex-direction:column;gap:14px' });
  const footBox = h('div', { class: 'foot' });
  const seen = new Set();
  const playersCard = h('div', { class: 'card' }, countEl, playersBox);

  function update(v) {
    const isHost = !!(v.you && v.you.isHost);
    countEl.textContent = `El le3bin (${v.players.length}/${v.limits.max})`;
    playersBox.replaceChildren(...v.players.map((p) => {
      const isNew = !seen.has(p.id); seen.add(p.id);
      return h('div', { class: `pl${p.connected ? '' : ' off'}${v.you && p.id === v.you.id ? ' me' : ''}${isNew ? ' pop' : ''}` },
        p.isHost ? h('span', { class: 'tag' }, '👑') : null,
        isHost && !p.isHost ? h('button', { class: 'x', type: 'button', title: 'Tla33ou', onclick: () => { if (confirm(`Tla33 ${p.name}?`)) act('kick', { id: p.id }); } }, '✕') : null,
        h('span', { class: 'a' }, p.avatar), h('span', { class: 'n' }, p.name));
    }));
    // settings
    const s = v.settings, canEdit = isHost;
    const total = S.info.categories.filter((c) => s.categories.includes(c.id)).reduce((a, c) => a + c.count, 0);
    settingsBox.replaceChildren(
      h('div', null, h('label', { class: 'lbl' }, 'Chhal men round'), h('div', { class: `seg ${canEdit ? '' : 'ro'}` }, S.info.roundOptions.map((n) =>
        h('button', { type: 'button', class: s.rounds === n ? 'on' : '', onclick: () => act('settings', { settings: { rounds: n } }) }, n === 0 ? '∞' : String(n))))),
      h('button', { type: 'button', class: `switch ${s.scoring ? 'on' : ''} ${canEdit ? '' : 'ro'}`, onclick: () => act('settings', { settings: { scoring: !s.scoring } }) },
        h('span', { class: 'tg' }), h('span', null, h('b', null, 'Points & classement 🏆'), h('br'), h('span', { class: 'muted', style: 'font-size:13px' }, s.scoring ? 'Mode compétition: rounds spéciaux + bonus' : 'Mode décontracté: ghir lel fadha7'))),
      h('div', null, h('label', { class: 'lbl' }, `Les catégories (${total} so2el)`), h('div', { class: `chips ${canEdit ? '' : 'ro'}` }, S.info.categories.map((c) => {
        const on = s.categories.includes(c.id);
        return h('button', { type: 'button', class: `cat ${on ? 'on' : ''}`, onclick: () => {
          const next = on ? s.categories.filter((x) => x !== c.id) : [...s.categories, c.id];
          if (!next.length) return toast(ERR.need_category, true); act('settings', { settings: { categories: next } }); } }, `${c.emoji} ${c.name} `, h('small', null, c.count));
      }))));
    // footer
    const n = v.players.filter((p) => p.connected).length;
    footBox.replaceChildren(...(isHost ? [
      h('button', { class: 'btn yel', type: 'button', disabled: n < v.limits.min, onclick: () => { Sfx.unlock(); act('start'); } }, n < v.limits.min ? `Stanna s7abek… (${n}/${v.limits.min})` : '🚀 Ibda el le3ba!'),
    ] : v.you ? [h('p', { class: 'hint' }, `Stanna el host ${P(v.hostId) ? P(v.hostId).name : ''} yebda el le3ba… ⏳`)] : [h('p', { class: 'hint' }, 'El écran yetsama3 lel host 📺 — el le3ba tebda 3al téléphones')]));
  }
  const el = isScreen
    ? h('div', { class: 'screen' }, h('div', { class: 'lobby-grid' }, joinCard, h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, playersCard, settingsBox, footBox)))
    : h('div', { class: 'screen' }, joinCard, playersCard, settingsBox, footBox);
  return { el, update };
}

/* ============================================================ VOTING */
function roundHeader(v) {
  const r = v.round, total = v.totalRounds;
  return h('div', { class: 'topline' },
    h('span', { class: 'badge' }, `Round ${r.n}${total ? ' / ' + total : ''}`),
    h('span', { class: 'badge' }, `${(S.info.categories.find((c) => c.id === r.cat) || {}).emoji || ''} ${CAT_NAME[r.cat] || ''}`));
}
function buildVoting() {
  const v0 = S.view, r0 = v0.round;
  const qcard = h('div', { class: 'qcard' }, h('div', { class: 'cat-l' }, 'Chkoun akther we7ed…'), h('h2', null, r0.text.replace(/^Chkoun akther we7ed\s*/i, '').replace(/^./, (c) => c.toUpperCase())));
  const banner = r0.special ? h('div', { class: 'sbanner' }, SPECIAL[r0.special]) : null;
  const area = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  const extra = h('div', { class: 'minirow' });
  const confirmBar = h('div', { class: 'confirm' });
  let mode = '', selectedBound = null;
  S.selected = null;

  function votedDots(v) {
    const voted = new Set(v.round.voted);
    return h('div', { class: 'dots' }, v.round.candidates.map((id) => { const p = P(id); if (!p) return null; const ok = voted.has(id);
      return h('div', { class: `dot ${ok ? 'ok' : p.connected ? 'pend' : 'gone'}`, title: p.name }, p.avatar); }));
  }
  function update(v) {
    const r = v.round, you = r.you, voters = r.candidates.length, done = r.voted.length;
    let want;
    if (!you) want = 'screen'; else if (!you.participant) want = 'late'; else if (you.voted) want = 'wait'; else want = 'pick';
    if (want === 'pick') {
      if (mode !== 'pick') {
        mode = 'pick'; S.selected = null;
        const grid = h('div', { class: 'cands' });
        r.candidates.filter((id) => id !== v.you.id).forEach((id, i) => {
          const p = P(id); if (!p) return;
          grid.append(h('button', { type: 'button', class: `cand${p.connected ? '' : ' off'}`, style: `animation-delay:${i * 40}ms`, 'data-id': id,
            onclick: () => { S.selected = id; [...grid.children].forEach((c) => c.classList.toggle('sel', c.dataset.id === id)); Sfx.pop(); vibe(8); updateConfirm(); } },
            h('span', { class: 'a' }, p.avatar), h('span', { class: 'n' }, p.name)));
        });
        area.replaceChildren(grid);
        updateConfirm();
      }
    } else if (want === 'wait') {
      if (mode !== 'wait') {
        mode = 'wait'; confirmBar.replaceChildren();
        const mine = P(you.vote);
        area.replaceChildren(h('div', { class: 'card wait', 'data-wait': '1' }, h('div', { class: 'big' }, '🔒'), h('h3', null, 'Votitek tsajjlet!'),
          mine ? h('p', { class: 'muted' }, `Votit 3la ${mine.avatar} ${mine.name} — ma7ad ya3ref 😉`) : null,
          h('div', { 'data-dots': '1' }), h('p', { class: 'muted', 'data-count': '1' })));
      }
    } else if (want === 'late') {
      if (mode !== 'late') { mode = 'late'; area.replaceChildren(h('div', { class: 'card wait' }, h('div', { class: 'big' }, '👀'), h('h3', null, 'Stanna el round el jey'), h('p', { class: 'muted' }, 'Enta jit f wost round, tdkhol men el jey.'), h('div', { 'data-dots': '1' }), h('p', { class: 'muted', 'data-count': '1' }))); }
    } else if (want === 'screen') {
      if (mode !== 'screen') { mode = 'screen'; area.replaceChildren(h('div', { class: 'card wait' }, h('div', { class: 'big' }, '🤫'), h('h3', null, 'Kol we7ed ysawwet 3al téléphone mta3ou'), h('div', { 'data-dots': '1' }), h('p', { class: 'muted', 'data-count': '1' }))); }
    }
    const dots = area.querySelector('[data-dots]'); if (dots) dots.replaceWith((() => { const d = votedDots(v); d.setAttribute('data-dots', '1'); return d; })());
    const cnt = area.querySelector('[data-count]'); if (cnt) cnt.textContent = `${done} / ${voters} votaw`;

    // secondary controls (skip / reveal-now)
    extra.replaceChildren();
    if (you && you.participant) {
      const isHost = v.you.isHost;
      extra.append(h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { if (isHost) act('skip'); else act('skipvote'); } },
        isHost ? '⏭️ Skip so2el' : `⏭️ ${you.skipVoted ? 'Elghi skip' : 'Skip'}${r.skipCount ? ` (${r.skipCount})` : ''}`));
      if (isHost) extra.append(h('button', { class: 'btn ghost sm', type: 'button', disabled: done < 1, onclick: () => act('reveal') }, `👀 Kchef dork (${done}/${voters})`));
    }
    if (you && v.you.isHost) extra.append(h('button', { class: 'btn ghost sm', type: 'button', style: 'flex:0 0 auto;width:auto', onclick: () => { if (confirm('Ta3mel nihayet el le3ba?')) act('end'); } }, '🏁'));
  }
  function updateConfirm() {
    const sel = P(S.selected);
    confirmBar.replaceChildren(h('button', { class: 'btn', type: 'button', disabled: !sel, onclick: async () => {
      if (!S.selected) return; const target = S.selected; Sfx.lock(); vibe(20);
      const ok = await act('vote', { target }); if (!ok) return; } },
      sel ? `🔒 Confirmi: ${sel.avatar} ${sel.name}` : 'Ekhtar we7ed 👆'));
  }
  const el = h('div', { class: 'screen' }, roundHeader(v0), banner, qcard, area, confirmBar, extra);
  return { el, update };
}

/* ============================================================ REVEAL */
function buildReveal() {
  const v = S.view, r = v.round, res = r.result, you = r.you;
  const animate = !!(S.prev && S.prev.phase === 'voting' && S.prev.round && S.prev.round.n === r.n);
  const ids = r.candidates.filter((id) => P(id));
  ids.sort((a, b) => (res.counts[b] || 0) - (res.counts[a] || 0) || P(a).name.localeCompare(P(b).name));
  const max = Math.max(0, ...ids.map((id) => res.counts[id] || 0));
  const win = new Set(res.winners);
  const rows = ids.map((id, i) => {
    const p = P(id), c = res.counts[id] || 0;
    return h('div', { class: `rr${win.has(id) ? ' win' : ''}`, style: `animation-delay:${i * 60}ms` },
      h('span', { class: 'a' }, p.avatar),
      h('div', { class: 'mid' }, h('div', { class: 'nm' }, p.name, you && you.participant && p.id === v.you.id ? h('small', null, ' (enta)') : null), h('div', { class: 'track' }, h('div', { class: 'fill', 'data-w': max ? Math.round(c / max * 100) : 0 }))),
      h('span', { class: 'cnt' }, String(c)));
  });
  const list = h('div', { class: 'res' }, rows);
  const drum = h('div', { class: 'drum' }, h('div', { class: 'e' }, '🥁'), h('h3', null, 'Wa9t el 7a9i9a…'), h('p', { class: 'muted' }, `${res.total} votaw`));
  const verdictBox = h('div');
  const ctrl = h('div', { class: 'foot' });

  function verdict() {
    const names = res.winners.map((id) => P(id)).filter(Boolean);
    let el;
    if (!names.length) el = h('div', { class: 'verdict' }, h('div', { class: 'big' }, '🤷'), h('h2', null, 'Ma7ad vota'), h('p', null, detPick(REACT.none, v.code + r.n)));
    else {
      const tie = names.length > 1, unanimous = !tie && res.total >= 3 && res.counts[names[0].id] === res.total;
      const pts = res.points[names[0].id] || 0;
      el = h('div', { class: 'verdict' },
        h('div', { class: 'big' }, names.map((p) => h('span', null, p.avatar))),
        h('h2', null, tie ? 'Ta3adol! 🤝 ' + names.map((p) => p.name).join(' + ') : names[0].name + ' 👑'),
        h('p', null, tie ? detPick(REACT.tie, v.code + r.n) : unanimous ? detPick(REACT.all, v.code + r.n) : detPick(REACT.one, v.code + r.n)),
        v.settings.scoring && pts ? h('span', { class: 'pts' }, `+${pts} point${pts > 1 ? 's' : ''}${r.special === 'double' ? ' ⭐' : ''}${tie ? ' (kol we7ed)' : ''}`) : null,
        you && you.bonus ? h('div', null, h('span', { class: 'bonus' }, '🤝 +1 bonus — ra2yek tla3 m3a el 3am!')) : null,
        you && !you.bonus && r.special === 'crowd' && v.settings.scoring ? h('div', { class: 'hint', style: 'margin-top:8px' }, `${res.bonusCount} men el le3bin khdhaw bonus 🤝`) : null);
    }
    return el;
  }
  function nextLabel(v2) {
    const done = v2.totalRounds > 0 && v2.round.n >= v2.totalRounds;
    if (done) return '🏁 Chouf el nataij';
    if (v2.settings.scoring && v2.round.n % v2.leaderboardEvery === 0) return '🏆 Classement';
    return '➡️ Round jey';
  }
  function update(v2) {
    if (v2.you && v2.you.isHost) ctrl.replaceChildren(h('button', { class: 'btn yel', type: 'button', onclick: () => act('next') }, nextLabel(v2)),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { if (confirm('Ta3mel nihayet el le3ba?')) act('end'); } }, '🏁 Wa9ef el le3ba'));
    else if (v2.you) ctrl.replaceChildren(h('p', { class: 'hint' }, 'Stanna el host yekmel… ⏳'));
    else ctrl.replaceChildren();
  }
  const reveal = () => {
    list.classList.add('shown'); $('.screen', $('#app')).classList.add('shown');
    list.querySelectorAll('.fill').forEach((f) => { f.style.width = f.dataset.w + '%'; });
    drum.remove(); verdictBox.replaceChildren(verdict());
    if (res.winners.length) { Sfx.boom(); later(() => { res.winners.length > 1 ? Sfx.tie() : Sfx.win(); Confetti.burst(res.winners.length > 1 ? 90 : 160); vibe([30, 40, 60]); }, 350); }
  };
  const el = h('div', { class: 'screen' }, roundHeader(v), h('div', { class: 'qcard', style: 'padding:14px' }, h('h2', { style: 'font-size:18px' }, r.text)), drum, list, verdictBox, ctrl);
  if (animate) { Sfx.drum(); vibe(40); later(reveal, 2300); } else { later(() => { reveal(); }, 30); }
  return { el, update };
}

/* ============================================================ LEADERBOARD */
function buildLeaderboard() {
  const v = S.view;
  const list = h('div', { class: 'lb' });
  const ctrl = h('div', { class: 'foot' });
  function update(v2) {
    const sorted = [...v2.players].sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name));
    const top = sorted.length ? sorted[0].score : 0;
    let rank = 0, prev = null;
    list.replaceChildren(...sorted.map((p, i) => {
      if (p.score !== prev) { rank = i + 1; prev = p.score; }
      return h('div', { class: `lrow${rank === 1 && top > 0 ? ' first' : ''}${v2.you && p.id === v2.you.id ? ' me' : ''}`, style: `animation-delay:${i * 70}ms` },
        h('span', { class: 'rk' }, rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank)),
        h('span', { class: 'a' }, p.avatar), h('span', { class: 'nm' }, p.name, h('div', { class: 'track', style: 'margin-top:6px' }, h('div', { class: 'fill', style: `width:${top ? Math.round(p.score / top * 100) : 0}%` }))),
        h('span', { class: 'sc' }, String(p.score)));
    }));
    const done = v2.totalRounds > 0 && v2.round.n >= v2.totalRounds;
    if (v2.you && v2.you.isHost) ctrl.replaceChildren(h('button', { class: 'btn yel', type: 'button', onclick: () => act('next') }, done ? '🏁 Nihayet el le3ba' : '➡️ Kamel'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { if (confirm('Ta3mel nihayet el le3ba?')) act('end'); } }, '🏁 Wa9ef el le3ba'));
    else if (v2.you) ctrl.replaceChildren(h('p', { class: 'hint' }, 'Stanna el host… ⏳'));
    else ctrl.replaceChildren();
  }
  later(() => Sfx.win(), 200);
  const el = h('div', { class: 'screen' }, h('div', { class: 'winner-h' }, h('div', { style: 'font-size:46px' }, '🏆'), h('div', { class: 't' }, 'Classement'), h('p', { class: 'muted' }, `Ba3d ${v.round.n} round${v.round.n > 1 ? 's' : ''}`)), list, ctrl);
  return { el, update };
}

/* ============================================================ FINAL */
function buildFinal() {
  const v = S.view, f = v.final;
  const ctrl = h('div', { class: 'foot' });
  const rk = f.ranking;
  const winners = rk.filter((r) => r.rank === 1);
  const podium = rk.filter((r) => r.rank <= 3).slice(0, 3);
  const order = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium;
  const heading = f.scoring ? (winners.length ? (winners.length > 1 ? 'El Winners 🏆' : `${winners[0].name} rba7!`) : 'Nihayet el le3ba') : 'Nihayet el le3ba';
  const sub = f.scoring ? (winners.length ? winners.map((w) => w.title).join(' • ') : '') : 'Mode décontracté: el classement 3la 7sab el votes';
  later(() => { Sfx.fin(); Confetti.burst(220); later(() => Confetti.burst(120), 900); vibe([60, 40, 60, 40, 120]); }, 300);
  const youId = v.you && v.you.id;
  const el = h('div', { class: 'screen' },
    h('div', { class: 'winner-h' }, h('div', { style: 'font-size:56px' }, '👑'), h('div', { class: 't' }, heading), h('p', { class: 'muted', style: 'margin-top:6px;font-weight:800' }, sub), h('p', { class: 'hint', style: 'margin-top:4px' }, `${f.rounds} round${f.rounds > 1 ? 's' : ''} t3adew`)),
    podium.length >= 2 ? h('div', { class: 'podium' }, order.map((p) => h('div', { class: `pod p${p.rank > 3 ? 3 : p.rank}` }, h('div', { class: 'a' }, p.avatar), h('div', { class: 'n' }, p.name), h('div', { class: 'ttl' }, p.title), h('div', { class: 'bl' }, f.scoring ? p.score : p.votes)))) : null,
    h('div', { class: 'lb' }, rk.map((p, i) => h('div', { class: `lrow${p.rank === 1 ? ' first' : ''}${p.id === youId ? ' me' : ''}`, style: `animation-delay:${400 + i * 70}ms` },
      h('span', { class: 'rk' }, p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : String(p.rank)),
      h('span', { class: 'a' }, p.avatar), h('span', { class: 'nm' }, p.name, h('div', { class: 'tt' }, p.title)),
      h('span', { class: 'sc' }, f.scoring ? p.score : p.votes)))),
    f.awards.length ? h('div', { class: 'awards' }, f.awards.map((a) => { const p = rk.find((x) => x.id === a.id); return h('div', { class: 'award' }, h('div', { class: 'e' }, a.emoji), h('div', { class: 'l' }, a.label), h('div', { class: 'w' }, p ? `${p.avatar} ${p.name}` : '?'), h('div', { class: 'hint' }, a.detail)); })) : null,
    ctrl);
  function update(v2) {
    if (v2.you && v2.you.isHost) ctrl.replaceChildren(h('button', { class: 'btn yel', type: 'button', onclick: () => act('again') }, '🔁 A3ed el le3ba'));
    else if (v2.you) ctrl.replaceChildren(h('p', { class: 'hint' }, 'Stanna el host y3awed… ⏳'), h('button', { class: 'btn ghost sm', type: 'button', onclick: leave }, '🚪 Khrouj'));
    else ctrl.replaceChildren();
  }
  return { el, update };
}

/* ============================================================ misc UI */
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Tcopa ✅'); }
  catch (_) { const t = h('textarea', { style: 'position:fixed;opacity:0' }, text); document.body.append(t); t.select(); try { document.execCommand('copy'); toast('Tcopa ✅'); } catch (__) { toast(text); } t.remove(); }
}
async function leave() {
  if (!S.session) return;
  if (!confirm('Tokhrej men el partie?')) return;
  try { await api('/api/act', { code: S.session.code, token: S.session.token, type: 'leave' }); } catch (_) {}
  gone();
}
$('#muteBtn').addEventListener('click', () => { S.muted = !S.muted; store.set('ckw.muted', S.muted); renderBar(); if (!S.muted) { Sfx.unlock(); Sfx.pop(); } });
$('#leaveBtn').addEventListener('click', leave);
$('#codeChip').addEventListener('click', () => { if (S.view) copy(S.view.code); });
document.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });

/* ============================================================ boot */
(async function boot() {
  try { S.info = await (await fetch('/api/info', { cache: 'no-store' })).json(); }
  catch (_) { $('#app').append(h('div', { class: 'card center', style: 'margin-top:40px' }, h('h3', null, 'Ma najamnach nconnectiw 📶'), h('p', { class: 'muted' }, 'Verifi el internet w 3awed 7ammel el page.'))); return; }
  S.info.categories.forEach((c) => { CAT_NAME[c.id] = c.name; });
  const q = new URLSearchParams(location.search);
  const scr = (q.get('screen') || '').toUpperCase();
  if (scr) { S.screen = scr; document.body.classList.add('screen'); render(); connect(); return; }
  const saved = store.get('ckw.session');
  if (saved && saved.code && saved.token) {
    try {
      const r = await fetch(`/api/state?code=${saved.code}&token=${saved.token}`, { cache: 'no-store' });
      if (r.ok) { const view = await r.json(); if (view.you) { S.session = saved; onState(view); connect(); toast('Rja3t lel partie 🔄'); return; } }
    } catch (_) {}
    dropSession();
  }
  render();
})();
})();
