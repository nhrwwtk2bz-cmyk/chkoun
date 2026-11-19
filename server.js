'use strict';
/**
 * Chkoun Akther Wa7ed? — real-time multiplayer server (zero dependencies).
 *
 * Transport : Server-Sent Events (server -> client) + JSON POST (client -> server).
 *             Works through every proxy/CDN that supports streaming responses and
 *             reconnects automatically (EventSource) — ideal for flaky phone networks.
 * Authority : the server owns ALL game state. Clients only send intents.
 * Anonymity : individual votes live only in server memory and are NEVER included in
 *             any payload. Clients receive per-target counts, nothing else.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { CATEGORIES, QUESTIONS } = require('./questions');

const PORT = +process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GRACE_MS = +process.env.GRACE_MS || 12000;       // disconnected players still "present" for this long
const HOST_GRACE_MS = +process.env.HOST_GRACE_MS || 20000; // then the host role migrates
const STALE_MS = +process.env.STALE_MS || 35000;       // no ping at all => treat as disconnected
const LOBBY_DROP_MS = +process.env.LOBBY_DROP_MS || 90000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const LEADERBOARD_EVERY = 3;
const ROUND_OPTIONS = [5, 10, 15, 20, 0]; // 0 = endless (host ends the game)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const AVATARS = ['😎', '🤡', '👻', '🦁', '🐯', '🐸', '🦊', '🐼', '🐵', '🦄', '🐙', '🦖',
  '👽', '🤖', '💀', '🔥', '🍕', '🧿', '🐪', '🦅', '🐢', '🐊', '🥷', '🍋'];

const TITLES = {
  first: ['Ra2is el Drama 👑', 'Sultan el Chaos 🔥', 'Mol el Mochkla 🚨', 'Zaim el 7ouma 🎤', 'Ma3lem el Fodhi 😎'],
  second: ['Wazir el Fadha7 🥈', 'Na2eb el Ra2is 😏', 'Kad 7atta ykoun Sultan 🥈'],
  third: ['Moustachar el 7ouma 🥉', 'Mocharek fi el Drama 🥉', 'El Barra el Jdid 🥉'],
  middle: ['Figurant fi el film 🎬', 'Sa7eb el 3a9el el 7ar 🧠', 'Mrawwa7 bel 3ar 🚶', 'Ma3rouf bel hdoua 😌'],
  last: ['Mol el 9alb el Abyadh 😇', 'Mal2ek el groupe 🕊️', 'Ma7ad chafou 👻', 'El Barri2 el Wa7id 🍼'],
};

/* ------------------------------------------------------------------ utils */
const rooms = new Map();
const now = () => Date.now();
const rid = (n = 4) => crypto.randomBytes(n).toString('hex');
const pick = (arr) => arr[crypto.randomInt(arr.length)];

function makeCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('no_code');
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}
function cleanAvatar(a) { return AVATARS.includes(a) ? a : pick(AVATARS); }

/* -------------------------------------------------------------- rate limit */
const buckets = new Map();
function rateLimited(req, cost = 1, max = 40, windowMs = 60000) {
  if (process.env.RATE_LIMIT === 'off') return false;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').toString().split(',')[0].trim();
  const b = buckets.get(ip) || { n: 0, reset: now() + windowMs };
  if (now() > b.reset) { b.n = 0; b.reset = now() + windowMs; }
  b.n += cost; buckets.set(ip, b);
  return b.n > max;
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60000).unref();

/* ------------------------------------------------------------------- rooms */
function newRoom() {
  const code = makeCode();
  const room = {
    code, hostId: null, players: new Map(), conns: new Set(),
    phase: 'lobby', v: 0,
    settings: { categories: CATEGORIES.map((c) => c.id), scoring: true, rounds: 10 },
    roundNo: 0, round: null, used: new Set(), lastSpecialRound: -5, final: null,
    createdAt: now(), lastActivity: now(),
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, avatar) {
  const p = {
    id: rid(3), token: rid(16), name, avatar, connected: false, disconnectedAt: now(), lastSeen: now(),
    score: 0, wins: 0, votes: 0, rounds: 0, left: false, joinedAt: now(),
  };
  room.players.set(p.id, p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

const active = (room) => [...room.players.values()].filter((p) => !p.left);
// "present" = connected, or within the reconnect grace window
const isPresent = (p) => !p.left && (p.connected || now() - p.disconnectedAt < GRACE_MS);
const byToken = (room, token) => token && [...room.players.values()].find((p) => p.token === token && !p.left);

function promoteHost(room) {
  const cur = room.players.get(room.hostId);
  if (cur && !cur.left && (cur.connected || now() - cur.disconnectedAt < HOST_GRACE_MS)) return false;
  const next = active(room).filter((p) => p.connected && p.id !== room.hostId).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (!next) return false;
  room.hostId = next.id;
  return true;
}

/* -------------------------------------------------------------------- views */
function publicPlayer(room, p) {
  return { id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, score: p.score, wins: p.wins, isHost: p.id === room.hostId };
}

function viewFor(room, me) {
  const r = room.round;
  const v = {
    v: room.v, code: room.code, phase: room.phase, hostId: room.hostId,
    you: me ? { id: me.id, isHost: me.id === room.hostId } : null,
    settings: room.settings,
    limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
    players: active(room).map((p) => publicPlayer(room, p)),
    roundNo: room.roundNo,
    totalRounds: room.settings.rounds,
    leaderboardEvery: LEADERBOARD_EVERY,
    round: null,
    final: room.final,
  };
  if (r) {
    const showResult = room.phase === 'reveal' || room.phase === 'leaderboard';
    v.round = {
      n: r.n, text: r.q.text, cat: r.q.cat, special: r.special,
      candidates: r.participants,
      voted: [...r.votes.keys()],               // WHO has voted (progress only) — never for whom
      skipCount: r.skipVotes.size,
      you: me ? {
        participant: r.participants.includes(me.id),
        voted: r.votes.has(me.id),
        vote: r.votes.get(me.id) || null,       // your own vote only
        skipVoted: r.skipVotes.has(me.id),
        bonus: showResult && r.result ? r.result.bonusVoters.has(me.id) : false,
      } : null,
      result: showResult && r.result ? {
        counts: r.result.counts, winners: r.result.winners, points: r.result.points,
        total: r.result.total, bonusCount: r.result.bonusVoters.size,
      } : null,
    };
  }
  return v;
}

/* ---------------------------------------------------------------- realtime */
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

function broadcast(room) {
  room.v++;
  room.lastActivity = now();
  for (const c of room.conns) {
    try { sse(c.res, 'state', viewFor(room, c.playerId ? room.players.get(c.playerId) : null)); } catch (_) { /* closed */ }
  }
}

function openStream(req, res, room, player) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1500\n\n');
  const conn = { res, playerId: player ? player.id : null };
  room.conns.add(conn);
  req.socket.setKeepAlive(true, 15000);
  req.socket.setNoDelay(true);
  if (player) { player.connected = true; player.lastSeen = now(); }
  broadcast(room); // everyone (incl. this conn) gets a fresh snapshot
  req.on('close', () => {
    room.conns.delete(conn);
    if (player) {
      const still = [...room.conns].some((c) => c.playerId === player.id);
      if (!still && player.connected) { player.connected = false; player.disconnectedAt = now(); broadcast(room); onPresenceChange(room); }
    }
  });
}

/* ------------------------------------------------------------- game engine */
function pickQuestion(room) {
  const pool = QUESTIONS.filter((q) => room.settings.categories.includes(q.cat));
  let avail = pool.filter((q) => !room.used.has(q.id));
  if (!avail.length) { pool.forEach((q) => room.used.delete(q.id)); avail = pool; }
  const q = pick(avail);
  room.used.add(q.id);
  return q;
}

function startRound(room, isSkip = false) {
  if (!isSkip) room.roundNo++;
  const participants = active(room).filter((p) => isPresent(p)).map((p) => p.id);
  let special = null;
  if (!isSkip && room.settings.scoring && room.roundNo >= 3 && room.roundNo - room.lastSpecialRound > 1 && crypto.randomInt(100) < 25) {
    special = pick(['double', 'crowd']);
    room.lastSpecialRound = room.roundNo;
  } else if (isSkip && room.round) special = room.round.special;
  room.round = { n: room.roundNo, q: pickQuestion(room), special, participants, votes: new Map(), skipVotes: new Set(), result: null };
  room.phase = 'voting';
}

function presentVoters(room) {
  const r = room.round;
  return r.participants.map((id) => room.players.get(id)).filter((p) => p && (isPresent(p) || r.votes.has(p.id)));
}

function maybeFinishVoting(room) {
  if (room.phase !== 'voting' || !room.round) return false;
  const voters = presentVoters(room);
  if (voters.length === 0) return false;
  if (voters.every((p) => room.round.votes.has(p.id))) { reveal(room); return true; }
  return false;
}

function reveal(room) {
  const r = room.round;
  const counts = {};
  r.participants.forEach((id) => { counts[id] = 0; });
  for (const target of r.votes.values()) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const winners = max > 0 ? Object.keys(counts).filter((id) => counts[id] === max) : [];
  const points = {};
  const bonusVoters = new Set();
  if (room.settings.scoring) {
    winners.forEach((id) => { points[id] = r.special === 'double' ? 2 : 1; });
    if (r.special === 'crowd') for (const [voter, target] of r.votes) if (winners.includes(target)) bonusVoters.add(voter);
  }
  for (const id of r.participants) {
    const p = room.players.get(id); if (!p) continue;
    p.rounds++; p.votes += counts[id] || 0;
    if (winners.includes(id)) p.wins++;
    p.score += (points[id] || 0) + (bonusVoters.has(id) ? 1 : 0);
  }
  r.result = { counts, winners, points, total: r.votes.size, bonusVoters };
  room.phase = 'reveal';
}

function finalize(room) {
  const scoring = room.settings.scoring;
  const list = active(room).filter((p) => p.rounds > 0);
  const key = (p) => (scoring ? [p.score, p.wins, p.votes] : [p.votes, p.wins, 0]);
  list.sort((a, b) => { const ka = key(a), kb = key(b); return (kb[0] - ka[0]) || (kb[1] - ka[1]) || (kb[2] - ka[2]); });
  let rank = 0, prev = null;
  const ranking = list.map((p, i) => {
    const k = key(p).join('|');
    if (k !== prev) { rank = i + 1; prev = k; }
    return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, wins: p.wins, votes: p.votes, rank };
  });
  const lastRank = ranking.length ? ranking[ranking.length - 1].rank : 0;
  const used = new Set();
  const title = (pool) => { const free = pool.filter((t) => !used.has(t)); const t = pick(free.length ? free : pool); used.add(t); return t; };
  ranking.forEach((r) => {
    if (r.rank === 1) r.title = title(TITLES.first);
    else if (r.rank === 2) r.title = title(TITLES.second);
    else if (r.rank === 3) r.title = title(TITLES.third);
    else if (r.rank === lastRank && ranking.length >= 4) r.title = title(TITLES.last);
    else r.title = title(TITLES.middle);
  });
  const awards = [];
  if (list.length >= 2) {
    const most = [...list].sort((a, b) => b.votes - a.votes)[0];
    const least = [...list].sort((a, b) => a.votes - b.votes)[0];
    if (most.votes > 0) awards.push({ key: 'target', emoji: '🎯', label: 'El Hadaf — akther votes', id: most.id, detail: `${most.votes} votes` });
    if (least.id !== most.id) awards.push({ key: 'angel', emoji: '😇', label: 'El Mal2ek — a9al votes', id: least.id, detail: `${least.votes} votes` });
  }
  room.final = { scoring, rounds: room.roundNo, ranking, awards };
  room.phase = 'final';
}

function resetToLobby(room) {
  room.phase = 'lobby'; room.round = null; room.roundNo = 0; room.final = null; room.lastSpecialRound = -5;
  for (const p of room.players.values()) { p.score = 0; p.wins = 0; p.votes = 0; p.rounds = 0; }
}

function advance(room) {
  // called when the host taps "next" on reveal / leaderboard
  const total = room.settings.rounds;
  const done = total > 0 && room.roundNo >= total;
  if (done) return finalize(room);
  if (room.phase === 'reveal' && room.settings.scoring && room.roundNo % LEADERBOARD_EVERY === 0) { room.phase = 'leaderboard'; return; }
  if (presentPlayers(room) < 2) { room.phase = 'leaderboard'; return; }
  startRound(room);
}
const presentPlayers = (room) => active(room).filter(isPresent).length;

/* Called whenever presence may have changed (disconnect / sweep). */
function onPresenceChange(room) {
  let changed = false;
  if (promoteHost(room)) changed = true;
  if (maybeFinishVoting(room)) changed = true;
  if (changed) broadcast(room);
}

/* ----------------------------------------------------------------- actions */
function act(room, me, body) {
  const t = body.type;
  const isHost = me.id === room.hostId;
  const r = room.round;
  me.lastSeen = now();
  switch (t) {
    case 'ping': return { ok: true, silent: true };

    case 'settings': {
      if (!isHost || room.phase !== 'lobby') return { error: 'not_allowed' };
      const s = body.settings || {};
      if (Array.isArray(s.categories)) {
        const cats = s.categories.filter((c) => CATEGORIES.some((x) => x.id === c));
        if (!cats.length) return { error: 'need_category' };
        room.settings.categories = [...new Set(cats)];
      }
      if (typeof s.scoring === 'boolean') room.settings.scoring = s.scoring;
      if (ROUND_OPTIONS.includes(s.rounds)) room.settings.rounds = s.rounds;
      return { ok: true };
    }

    case 'start': {
      if (!isHost || room.phase !== 'lobby') return { error: 'not_allowed' };
      if (presentPlayers(room) < MIN_PLAYERS) return { error: 'need_players' };
      // drop players who are not around at start
      for (const p of active(room)) if (!isPresent(p)) { p.left = true; }
      resetToLobby(room);
      startRound(room);
      return { ok: true };
    }

    case 'vote': {
      if (room.phase !== 'voting' || !r) return { error: 'not_voting' };
      if (!r.participants.includes(me.id)) return { error: 'not_in_round' };
      if (r.votes.has(me.id)) return { error: 'already_voted' };
      const target = String(body.target || '');
      if (target === me.id) return { error: 'self_vote' };
      if (!r.participants.includes(target)) return { error: 'bad_target' };
      r.votes.set(me.id, target);
      maybeFinishVoting(room);
      return { ok: true };
    }

    case 'skipvote': { // group-democracy skip: majority of present voters
      if (room.phase !== 'voting' || !r || !r.participants.includes(me.id)) return { error: 'not_allowed' };
      if (r.skipVotes.has(me.id)) r.skipVotes.delete(me.id); else r.skipVotes.add(me.id);
      const need = Math.floor(presentVoters(room).length / 2) + 1;
      if (r.skipVotes.size >= need) startRound(room, true);
      return { ok: true };
    }

    case 'skip': {
      if (!isHost || room.phase !== 'voting') return { error: 'not_allowed' };
      startRound(room, true);
      return { ok: true };
    }

    case 'reveal': { // host forces reveal (somebody is slow / asleep)
      if (!isHost || room.phase !== 'voting' || !r) return { error: 'not_allowed' };
      if (r.votes.size < 1) return { error: 'no_votes' };
      reveal(room);
      return { ok: true };
    }

    case 'next': {
      if (!isHost || (room.phase !== 'reveal' && room.phase !== 'leaderboard')) return { error: 'not_allowed' };
      if (room.phase === 'leaderboard') {
        const total = room.settings.rounds;
        if (total > 0 && room.roundNo >= total) finalize(room);
        else if (presentPlayers(room) < 2) return { error: 'need_players' };
        else startRound(room);
      } else advance(room);
      return { ok: true };
    }

    case 'end': {
      if (!isHost || !['voting', 'reveal', 'leaderboard'].includes(room.phase)) return { error: 'not_allowed' };
      if (room.phase === 'voting' && r && r.votes.size === 0) room.roundNo = Math.max(0, room.roundNo - 1);
      if (room.roundNo === 0 || !active(room).some((p) => p.rounds > 0)) resetToLobby(room); else finalize(room);
      return { ok: true };
    }

    case 'again': {
      if (!isHost || room.phase !== 'final') return { error: 'not_allowed' };
      resetToLobby(room);
      return { ok: true };
    }

    case 'kick': {
      if (!isHost) return { error: 'not_allowed' };
      const p = room.players.get(String(body.id || ''));
      if (!p || p.id === me.id) return { error: 'bad_target' };
      removePlayer(room, p, true);
      return { ok: true };
    }

    case 'leave': {
      removePlayer(room, me, false);
      return { ok: true, left: true };
    }
    default: return { error: 'unknown_action' };
  }
}

function removePlayer(room, p, kicked) {
  if (room.phase === 'lobby') room.players.delete(p.id); else p.left = true;
  if (room.round) { room.round.votes.delete(p.id); room.round.skipVotes.delete(p.id); }
  for (const c of [...room.conns]) {
    if (c.playerId === p.id) { try { sse(c.res, kicked ? 'kicked' : 'left', {}); c.res.end(); } catch (_) {} room.conns.delete(c); }
  }
  p.connected = false;
  promoteHost(room);
  if (room.phase === 'voting') maybeFinishVoting(room);
}

/* --------------------------------------------------------------- housekeeping */
setInterval(() => {
  const t = now();
  for (const room of [...rooms.values()]) {
    let changed = false;
    // stale half-open connections (phone went offline without closing the socket)
    for (const p of room.players.values()) {
      if (p.connected && t - p.lastSeen > STALE_MS) {
        p.connected = false; p.disconnectedAt = t; changed = true;
        for (const c of [...room.conns]) if (c.playerId === p.id) { try { c.res.end(); } catch (_) {} room.conns.delete(c); }
      }
    }
    if (room.phase === 'lobby') {
      for (const p of [...room.players.values()]) {
        if (!p.connected && t - p.disconnectedAt > LOBBY_DROP_MS && p.id !== room.hostId) { room.players.delete(p.id); changed = true; }
      }
    }
    if (promoteHost(room)) changed = true;
    if (maybeFinishVoting(room)) changed = true;
    if (changed) broadcast(room);
    const idle = t - room.lastActivity;
    if ((room.conns.size === 0 && idle > ROOM_IDLE_MS) || t - room.createdAt > ROOM_MAX_AGE_MS) rooms.delete(room.code);
  }
}, 1000).unref();

setInterval(() => {
  for (const room of rooms.values()) for (const c of room.conns) { try { c.res.write(': hb\n\n'); sse(c.res, 'hb', { t: now() }); } catch (_) {} }
}, 15000).unref();

/* -------------------------------------------------------------------- http */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function json(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 16384) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { // SPA fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }); res.end(b2);
      });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });

    if (p === '/api/info') {
      const counts = {}; QUESTIONS.forEach((q) => { counts[q.cat] = (counts[q.cat] || 0) + 1; });
      return json(res, 200, {
        lan: lanUrls(), publicUrl: process.env.PUBLIC_URL || null, avatars: AVATARS, roundOptions: ROUND_OPTIONS,
        categories: CATEGORIES.map((c) => ({ ...c, count: counts[c.id] || 0 })), limits: { min: MIN_PLAYERS, max: MAX_PLAYERS },
      });
    }

    if (p === '/api/create' && req.method === 'POST') {
      if (rateLimited(req, 4, 80)) return json(res, 429, { error: 'slow_down' });
      if (rooms.size > 2000) return json(res, 503, { error: 'busy' });
      const b = await readBody(req);
      const name = cleanName(b.name);
      if (!name) return json(res, 400, { error: 'need_name' });
      const room = newRoom();
      const me = addPlayer(room, name, cleanAvatar(b.avatar));
      return json(res, 200, { code: room.code, token: me.token, playerId: me.id });
    }

    if (p === '/api/join' && req.method === 'POST') {
      if (rateLimited(req, 2, 120)) return json(res, 429, { error: 'slow_down' });
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase().trim());
      if (!room) return json(res, 404, { error: 'no_room' });
      const existing = byToken(room, b.token);
      if (existing) return json(res, 200, { code: room.code, token: existing.token, playerId: existing.id, resumed: true });
      const name = cleanName(b.name);
      if (!name) return json(res, 400, { error: 'need_name' });
      if (active(room).length >= MAX_PLAYERS) return json(res, 409, { error: 'room_full' });
      if (active(room).some((x) => x.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'name_taken' });
      const me = addPlayer(room, name, cleanAvatar(b.avatar));
      broadcast(room);
      return json(res, 200, { code: room.code, token: me.token, playerId: me.id });
    }

    if (p === '/api/screen-check') { // is this room alive? (used by auto-reconnect)
      const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
      return json(res, room ? 200 : 404, { ok: !!room });
    }

    if (p === '/api/events') {
      const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
      if (!room) { res.writeHead(404); return res.end(); }
      if (url.searchParams.get('screen') === '1') return openStream(req, res, room, null);
      const me = byToken(room, url.searchParams.get('token'));
      if (!me) { res.writeHead(401); return res.end(); }
      return openStream(req, res, room, me);
    }

    if (p === '/api/state') {
      const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
      if (!room) return json(res, 404, { error: 'no_room' });
      const me = byToken(room, url.searchParams.get('token'));
      return json(res, 200, viewFor(room, me || null));
    }

    if (p === '/api/act' && req.method === 'POST') {
      const b = await readBody(req);
      const room = rooms.get(String(b.code || '').toUpperCase());
      if (!room) return json(res, 404, { error: 'no_room' });
      const me = byToken(room, b.token);
      if (!me) return json(res, 401, { error: 'bad_token' });
      if (b.type !== 'ping' && rateLimited(req, 1, 900)) return json(res, 429, { error: 'slow_down' });
      const out = act(room, me, b);
      if (out.error) return json(res, 400, out);
      if (!out.silent) broadcast(room);
      return json(res, 200, { ok: true, left: !!out.left });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
    res.writeHead(404); res.end();
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: 'bad_request' }); else res.end();
  }
});

server.keepAliveTimeout = 65000;
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Chkoun Akther Wa7ed? running on http://localhost:${PORT}`);
    lanUrls().forEach((u) => console.log(`  Same-WiFi phones can use: ${u}`));
    console.log('');
  });
}
module.exports = { server, rooms };
