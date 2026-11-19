'use strict';
// End-to-end simulation: spawns the real server and drives it with bot clients over real HTTP + SSE.
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 4600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(p, body) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

class Bot {
  constructor(name) { this.name = name; this.state = null; this.raw = []; this.waiters = []; this.req = null; this.ping = null; this.events = []; }
  async create() { const r = await post('/api/create', { name: this.name, avatar: '😎' }); Object.assign(this, r.body); this.code = r.body.code; return r; }
  async join(code, extra = {}) { const r = await post('/api/join', { code, name: this.name, avatar: '🤡', ...extra }); if (r.status === 200) { Object.assign(this, r.body); this.code = code; } return r; }
  open(screen = false) {
    return new Promise((resolve) => {
      const q = screen ? `code=${this.code}&screen=1` : `code=${this.code}&token=${this.token}`;
      this.req = http.get(`${BASE}/api/events?${q}`, (res) => {
        this.status = res.statusCode; let buf = '';
        res.setEncoding('utf8');
        res.on('data', (d) => {
          buf += d; let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk), da = /^data: (.*)$/m.exec(chunk);
            if (!ev || !da) continue;
            this.events.push(ev[1]);
            if (ev[1] === 'state') { this.raw.push(da[1]); this.state = JSON.parse(da[1]); this.waiters = this.waiters.filter((w) => { if (w.pred(this.state)) { w.res(this.state); return false; } return true; }); }
          }
        });
        res.on('close', () => { this.closed = true; });
        resolve();
      });
      this.req.on('error', () => {});
      this.closed = false;
      this.ping = setInterval(() => { if (this.token) post('/api/act', { code: this.code, token: this.token, type: 'ping' }).catch(() => {}); }, 1000);
    });
  }
  drop() { clearInterval(this.ping); if (this.req) this.req.destroy(); }
  waitFor(pred, ms = 6000) {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return new Promise((res, rej) => {
      const w = { pred, res };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); rej(new Error(`timeout waiting (${this.name}) phase=${this.state && this.state.phase}`)); } }, ms);
    });
  }
  act(type, extra = {}) { return post('/api/act', { code: this.code, token: this.token, type, ...extra }); }
}

async function newRoom(n, names) {
  const bots = []; const host = new Bot(names ? names[0] : 'Host'); await host.create(); await host.open(); bots.push(host);
  for (let i = 1; i < n; i++) { const b = new Bot(names ? names[i] : `P${i}`); const r = await b.join(host.code); if (r.status !== 200) throw new Error('join failed ' + JSON.stringify(r)); await b.open(); bots.push(b); }
  await host.waitFor((s) => s.players.length === n);
  return bots;
}
const closeAll = (bots) => bots.forEach((b) => b.drop());

(async () => {
  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, GRACE_MS: 1500, HOST_GRACE_MS: 2000, STALE_MS: 3500, LOBBY_DROP_MS: 3000, RATE_LIMIT: 'off' }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/healthz'); break; } catch (_) { await sleep(100); } }
  const T = async (name, fn) => { const before = fail; process.stdout.write(`▶ ${name}\n`); try { await fn(); } catch (e) { fail++; console.log('  ✗ EXCEPTION:', e.message); } console.log(fail === before ? '  ✓ ok' : '  ✗ failed'); };

  await T('static files + info endpoint', async () => {
    const html = await (await fetch(BASE + '/')).text(); ok(html.includes('Chkoun'), 'index served');
    const js = await fetch(BASE + '/app.js'); ok(js.status === 200, 'app.js served');
    const trav = await fetch(BASE + '/..%2f..%2fetc/passwd'); ok(trav.status !== 200 || !(await trav.text()).includes('root:'), 'no path traversal');
    const info = await (await fetch(BASE + '/api/info')).json(); ok(info.categories.length === 11 && info.categories.reduce((a, c) => a + c.count, 0) >= 200, '200+ questions in 11 categories');
  });

  await T('lobby: room code, join rules, limits', async () => {
    const host = new Bot('Ahmed'); const r = await host.create(); ok(/^[A-HJ-NP-Z2-9]{6}$/.test(host.code), 'valid 6-char code: ' + host.code); await host.open();
    const dup = new Bot('ahmed'); const rd = await dup.join(host.code); ok(rd.status === 409 && rd.body.error === 'name_taken', 'duplicate name rejected');
    const bad = await new Bot('X').join('ZZZZZZ'); ok(bad.status === 404, 'unknown room rejected');
    const nameless = await post('/api/join', { code: host.code, name: '   ' }); ok(nameless.status === 400, 'empty name rejected');
    const bots = [host];
    for (let i = 1; i < 12; i++) { const b = new Bot('Joueur' + i); const j = await b.join(host.code); ok(j.status === 200, 'join ' + i); await b.open(); bots.push(b); }
    const b13 = await new Bot('Extra').join(host.code); ok(b13.status === 409 && b13.body.error === 'room_full', '13th player rejected (max 12)');
    await host.waitFor((s) => s.players.length === 12);
    ok(host.state.players.every((p) => !('token' in p)), 'tokens never exposed');
    const s = await post('/api/act', { code: host.code, token: bots[3].token, type: 'start' }); ok(s.status === 400, 'non-host cannot start');
    const st = await host.act('start'); ok(st.status === 200, 'host starts with 12');
    await host.waitFor((s) => s.phase === 'voting'); ok(host.state.round.candidates.length === 12, '12 candidates');
    closeAll(bots);
  });

  await T('start needs 3 players', async () => {
    const [h, p] = await newRoom(2); const r = await h.act('start'); ok(r.status === 400 && r.body.error === 'need_players', 'blocked with 2 players'); closeAll([h, p]);
  });

  await T('settings: categories / rounds / scoring (host only)', async () => {
    const bots = await newRoom(3); const [h, a] = bots;
    ok((await a.act('settings', { settings: { rounds: 5 } })).status === 400, 'non-host cannot change settings');
    ok((await h.act('settings', { settings: { rounds: 5, scoring: false, categories: ['love', 'bogus'] } })).status === 200, 'host changes');
    await a.waitFor((s) => s.settings.rounds === 5); ok(a.state.settings.scoring === false && a.state.settings.categories.join() === 'love', 'synced to others + invalid cat dropped');
    ok((await h.act('settings', { settings: { categories: [] } })).status === 400, 'cannot empty categories');
    await h.act('start'); await h.waitFor((s) => s.phase === 'voting');
    ok(h.state.round.cat === 'love', 'questions respect selected category');
    ok((await h.act('settings', { settings: { rounds: 10 } })).status === 400, 'settings locked in game');
    closeAll(bots);
  });

  await T('voting rules + anonymity + ties + scoring + leaderboard + final', async () => {
    const bots = await newRoom(5, ['Ahmed', 'Sami', 'Nour', 'Yassine', 'Meryem']); const [h] = bots;
    await h.act('settings', { settings: { rounds: 5, scoring: true } });
    await h.act('start'); await Promise.all(bots.map((b) => b.waitFor((s) => s.phase === 'voting')));
    const ids = bots.map((b) => b.playerId);
    // rule checks
    ok((await bots[1].act('vote', { target: bots[1].playerId })).body.error === 'self_vote', 'self vote refused');
    ok((await bots[1].act('vote', { target: 'nope' })).body.error === 'bad_target', 'bad target refused');
    // ROUND 1: everyone votes for Ahmed (except Ahmed votes Sami) => Ahmed 4, unanimous-ish
    for (let i = 1; i < 5; i++) { ok((await bots[i].act('vote', { target: ids[0] })).status === 200, 'vote ok'); }
    ok((await bots[1].act('vote', { target: ids[2] })).body.error === 'already_voted', 'vote locked');
    await sleep(100);
    ok(h.state.phase === 'voting' && h.state.round.voted.length === 4, 'waits for the last voter');
    await bots[0].act('vote', { target: ids[1] });
    await Promise.all(bots.map((b) => b.waitFor((s) => s.phase === 'reveal')));
    let res = h.state.round.result; ok(res.counts[ids[0]] === 4 && res.counts[ids[1]] === 1 && res.winners.join() === ids[0], 'counts + winner correct');
    ok(h.state.players.find((p) => p.id === ids[0]).score === 1, 'winner got exactly 1 point in round 1 (no special rounds before round 3)');
    // anonymity: no payload for anybody ever contains someone else's vote
    for (const b of bots) for (const raw of b.raw) {
      const s = JSON.parse(raw); const you = s.round && s.round.you;
      ok(!/"votes?":\{/.test(raw) && !raw.includes('"voter'), 'no voter map in payload');
    }
    // each bot's payload only holds its OWN vote
    const sees = (b, target) => b.raw.some((r) => r.includes(`"vote":"${target}"`));
    ok(!sees(bots[2], ids[0]) || bots[2].state.round.you.vote === ids[0], 'bot sees only own vote');
    // bot 3 voted for ids[0]: bot 4 payloads must not contain "vote":"<ids0>" unless bot4's own vote was ids0 (it was). check with distinct voters instead:
    ok(bots[0].raw.every((r) => !r.includes(`"vote":"${ids[0]}"`)), 'Ahmed never sees any "vote":Ahmed (nobody can learn who voted for him)');
    await h.act('next'); await Promise.all(bots.map((b) => b.waitFor((s) => s.phase === 'voting' && s.round.n === 2)));
    // ROUND 2: cycle => perfect tie, everybody gets 1
    for (let i = 0; i < 5; i++) await bots[i].act('vote', { target: ids[(i + 1) % 5] });
    await h.waitFor((s) => s.phase === 'reveal' && s.round.n === 2);
    res = h.state.round.result; ok(res.winners.length === 5 && res.winners.every((w) => ids.includes(w)), 'tie shows all tied players');
    await h.act('next'); await h.waitFor((s) => s.round && s.round.n === 3 && s.phase === 'voting');
    // ROUND 3 : all vote Sami except Sami votes Nour
    for (let i = 0; i < 5; i++) await bots[i].act('vote', { target: i === 1 ? ids[2] : ids[1] });
    await h.waitFor((s) => s.phase === 'reveal' && s.round.n === 3);
    await h.act('next'); await h.waitFor((s) => s.phase === 'leaderboard'); ok(true, 'leaderboard after 3 rounds');
    ok(h.state.players.find((p) => p.id === ids[1]).score >= 2, 'Sami scored (tie in r2 + win in r3)'); ok(h.state.players.find((p) => p.id === ids[0]).score >= 2, 'Ahmed scored (win r1 + tie r2)');
    await h.act('next'); await h.waitFor((s) => s.phase === 'voting' && s.round.n === 4);
    const qb = h.state.round.text; await h.act('skip'); await h.waitFor((s) => s.round.text !== qb); ok(h.state.round.n === 4, 'host skip keeps round number');
    // majority skipvote (needs 3 of 5)
    const q0 = h.state.round.text; await bots[1].act('skipvote'); await bots[2].act('skipvote'); await sleep(80); ok(h.state.round.text === q0, '2/5 not enough'); await bots[3].act('skipvote');
    await h.waitFor((s) => s.round.text !== q0); ok(h.state.round.n === 4 && h.state.round.skipCount === 0, 'majority skip works');
    for (let i = 0; i < 5; i++) await bots[i].act('vote', { target: ids[(i + 2) % 5] });
    await h.waitFor((s) => s.phase === 'reveal' && s.round.n === 4); await h.act('next'); await h.waitFor((s) => s.phase === 'voting' && s.round.n === 5);
    // force reveal with partial votes
    await bots[1].act('vote', { target: ids[0] }); ok((await bots[2].act('reveal')).status === 400, 'only host can force reveal'); ok((await h.act('reveal')).status === 200, 'host forces reveal');
    await h.waitFor((s) => s.phase === 'reveal' && s.round.n === 5); res = h.state.round.result; ok(res.total === 1 && res.winners.join() === ids[0], 'partial round resolved');
    await h.act('next'); await h.waitFor((s) => s.phase === 'final');
    const f = h.state.final; ok(f.ranking.length === 5 && f.ranking.every((r) => r.title), 'final ranking with funny titles'); ok(f.ranking[0].rank === 1, 'rank 1 exists');
    ok(f.ranking.every((r, i) => i === 0 || f.ranking[i - 1].score >= r.score), 'ranking sorted by score');
    ok(f.awards.length === 2, 'awards computed');
    await h.act('again'); await h.waitFor((s) => s.phase === 'lobby'); ok(h.state.players.every((p) => p.score === 0), 'rematch resets scores');
    closeAll(bots);
  });

  await T('casual mode (no scoring) + endless + end game', async () => {
    const bots = await newRoom(3); const [h] = bots;
    await h.act('settings', { settings: { scoring: false, rounds: 0 } }); await h.act('start'); await h.waitFor((s) => s.phase === 'voting');
    for (let r = 1; r <= 4; r++) {
      await h.waitFor((s) => s.phase === 'voting' && s.round.n === r); ok(h.state.round.special === null, 'no special rounds in casual mode');
      for (let i = 0; i < 3; i++) await bots[i].act('vote', { target: bots[(i + 1) % 3].playerId });
      await h.waitFor((s) => s.phase === 'reveal' && s.round.n === r); ok(h.state.players.every((p) => p.score === 0), 'no points in casual');
      if (r < 4) await h.act('next');
    }
    await h.act('end'); await h.waitFor((s) => s.phase === 'final'); ok(h.state.final.scoring === false && h.state.final.ranking.length === 3, 'final in casual mode ranks by votes');
    closeAll(bots);
  });

  await T('disconnect: round completes after grace, reconnection keeps locked vote', async () => {
    const bots = await newRoom(4); const [h, a, b, c] = bots;
    await h.act('start'); await Promise.all(bots.map((x) => x.waitFor((s) => s.phase === 'voting')));
    const t0 = Date.now();
    await a.act('vote', { target: h.playerId }); // a votes then loses connection
    a.drop(); await sleep(150);
    await h.waitFor((s) => s.players.find((p) => p.id === a.playerId).connected === false); ok(true, 'others see disconnect immediately');
    // c also drops WITHOUT voting
    c.drop();
    await h.act('vote', { target: b.playerId }); await b.act('vote', { target: h.playerId });
    await h.waitFor((s) => s.phase === 'reveal', 8000);
    ok(Date.now() - t0 >= 1300, 'round waited for grace window before closing without disconnected voter (' + (Date.now() - t0) + 'ms)');
    ok(h.state.round.result.total === 3, '3 votes counted');
    // a reconnects with the same token and sees own locked vote
    const a2 = new Bot('Sami'); Object.assign(a2, { code: h.code, token: a.token, playerId: a.playerId }); await a2.open();
    await a2.waitFor((s) => s.you && s.you.id === a.playerId); ok(a2.state.round.you.vote === h.playerId && a2.state.phase === 'reveal', 'reconnect restores own vote + phase');
    await h.waitFor((s) => s.players.find((p) => p.id === a.playerId).connected); ok(true, 'marked connected again');
    // join endpoint with token resumes too
    const r = await post('/api/join', { code: h.code, token: c.token }); ok(r.status === 200 && r.body.resumed && r.body.playerId === c.playerId, 'join with token resumes identity');
    // next round: c is back
    const c2 = new Bot('Nour'); Object.assign(c2, { code: h.code, token: c.token, playerId: c.playerId }); await c2.open();
    await h.act('next'); await h.waitFor((s) => s.phase === 'voting' && s.round.n === 2); ok(h.state.round.candidates.length === 4, 'reconnected player back in next round');
    closeAll([h, b, a2, c2]);
  });

  await T('short blip: reconnect inside grace does not lose the player', async () => {
    const bots = await newRoom(3); const [h, a, b] = bots; await h.act('start'); await h.waitFor((s) => s.phase === 'voting');
    a.drop(); await sleep(300); const a2 = new Bot('P1'); Object.assign(a2, { code: h.code, token: a.token, playerId: a.playerId }); await a2.open();
    await h.act('vote', { target: b.playerId }); await b.act('vote', { target: h.playerId }); await sleep(400);
    ok(h.state.phase === 'voting', 'still waiting for the blipped player'); ok((await a2.act('vote', { target: h.playerId })).status === 200, 'blipped player votes');
    await h.waitFor((s) => s.phase === 'reveal'); closeAll([h, b, a2]);
  });

  await T('host migration when host disappears', async () => {
    const bots = await newRoom(3); const [h, a, b] = bots; h.drop();
    await a.waitFor((s) => s.hostId === a.playerId || s.hostId === b.playerId, 6000); ok(a.state.hostId !== h.playerId, 'host role migrated: ' + a.state.players.find((p) => p.id === a.state.hostId).name);
    const newHost = a.state.hostId === a.playerId ? a : b; ok((await newHost.act('settings', { settings: { rounds: 15 } })).status === 200, 'new host has control');
    closeAll([a, b]);
  });

  await T('stale half-open connection detected (no pings)', async () => {
    const bots = await newRoom(3); const [h, a] = bots; clearInterval(a.ping); // socket stays open but silent
    await h.waitFor((s) => s.players.find((p) => p.id === a.playerId).connected === false, 8000); ok(true, 'silent client marked offline'); closeAll(bots);
  });

  await T('late joiner mid-game is spectator until next round', async () => {
    const bots = await newRoom(3); const [h] = bots; await h.act('start'); await h.waitFor((s) => s.phase === 'voting');
    const late = new Bot('Retard'); ok((await late.join(h.code)).status === 200, 'late join allowed'); await late.open(); await late.waitFor((s) => s.phase === 'voting');
    ok(late.state.round.you.participant === false, 'not participant in current round'); ok((await late.act('vote', { target: h.playerId })).body.error === 'not_in_round', 'cannot vote');
    for (let i = 0; i < 3; i++) await bots[i].act('vote', { target: bots[(i + 1) % 3].playerId });
    await h.waitFor((s) => s.phase === 'reveal'); await h.act('next'); await late.waitFor((s) => s.phase === 'voting' && s.round.n === 2); ok(late.state.round.you.participant === true && late.state.round.candidates.length === 4, 'joins from next round');
    closeAll([...bots, late]);
  });

  await T('kick / leave / screen spectator / bad tokens', async () => {
    const bots = await newRoom(4); const [h, a, b, c] = bots;
    const scr = new Bot('screen'); scr.code = h.code; await scr.open(true); await scr.waitFor((s) => s.players.length === 4); ok(scr.state.you === null, 'screen gets spectator view');
    ok((await a.act('kick', { id: b.playerId })).status === 400, 'non-host cannot kick');
    ok((await h.act('kick', { id: b.playerId })).status === 200, 'host kicks'); await h.waitFor((s) => s.players.length === 3);
    ok((await b.act('ping')).status === 401, 'kicked token invalid');
    ok((await c.act('leave')).status === 200, 'leave works'); await h.waitFor((s) => s.players.length === 2);
    const noTok = await post('/api/act', { code: h.code, token: 'bad', type: 'ping' }); ok(noTok.status === 401, 'bad token rejected');
    const r = await new Promise((res) => http.get(`${BASE}/api/events?code=${h.code}&token=bad`, (x) => res(x.statusCode)));
    ok(r === 401, 'SSE with bad token => 401'); closeAll([h, a, scr]);
  });

  await T('12-player full game stress (all vote every round)', async () => {
    const bots = await newRoom(12); const [h] = bots; await h.act('settings', { settings: { rounds: 5 } }); await h.act('start');
    for (let r = 1; r <= 5; r++) {
      await Promise.all(bots.map((b) => b.waitFor((s) => s.phase === 'voting' && s.round.n === r)));
      await Promise.all(bots.map((b, i) => b.act('vote', { target: bots[(i + 1 + (r % 3)) % 12].playerId })));
      await Promise.all(bots.map((b) => b.waitFor((s) => s.phase === 'reveal' && s.round.n === r)));
      ok(h.state.round.result.total === 12, 'round ' + r + ': 12 votes');
      if (r < 5) { await h.act('next'); if (r === 3) { await h.waitFor((s) => s.phase === 'leaderboard'); await h.act('next'); } }
    }
    await h.act('next'); await h.waitFor((s) => s.phase === 'final'); ok(h.state.final.ranking.length === 12, '12 ranked');
    // payload anonymity audit across ALL traffic of ALL bots: the server only ever exposes the receiver's own vote
    let leaks = 0; for (const b of bots) for (const raw of b.raw) { const s = JSON.parse(raw); const votes = (raw.match(/"vote":/g) || []).length; if (votes > 1) leaks++; }
    ok(leaks === 0, 'never more than one "vote" field (own) in any payload');
    closeAll(bots);
  });

  server.kill();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} assertions passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
