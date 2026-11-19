/* Minimal QR Code generator (byte mode, ECC level M, versions 1-10, auto mask).
   Based on the public algorithm described in ISO/IEC 18004. No dependencies. */
(function (root) {
  'use strict';
  // index = version (1..10)
  var ECC_PER_BLOCK_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var NUM_BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

  function rawDataModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { var na = Math.floor(ver / 7) + 2; r -= (25 * na - 10) * na - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver]; }

  function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(deg) {
    var res = []; for (var i = 0; i < deg - 1; i++) res.push(0); res.push(1);
    var root = 1;
    for (var i2 = 0; i2 < deg; i2++) {
      for (var j = 0; j < deg; j++) { res[j] = gfMul(res[j], root); if (j + 1 < deg) res[j] ^= res[j + 1]; }
      root = gfMul(root, 2);
    }
    return res;
  }
  function rsRemainder(data, div) {
    var res = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ res.shift(); res.push(0);
      div.forEach(function (c, i) { res[i] ^= gfMul(c, f); });
    });
    return res;
  }

  function utf8(str) {
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function encode(text) {
    var bytes = utf8(text), ver, cap;
    for (ver = 1; ver <= 10; ver++) {
      var ccBits = ver < 10 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 10) throw new Error('text too long for QR');
    cap = dataCodewords(ver);
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, cap * 8 - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xec; bits.length < cap * 8; pad ^= 0xec ^ 0x11) put(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var v = 0; for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; data.push(v); }

    // split into blocks + ECC, interleave
    var nb = NUM_BLOCKS_M[ver], eccLen = ECC_PER_BLOCK_M[ver];
    var raw = Math.floor(rawDataModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(eccLen), blocks = [], pos = 0;
    for (var b = 0; b < nb; b++) {
      var dat = data.slice(pos, pos + shortLen - eccLen + (b < nShort ? 0 : 1)); pos += dat.length;
      var ecc = rsRemainder(dat, div);
      if (b < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var all = [];
    for (var x = 0; x < blocks[0].length; x++) for (var y = 0; y < blocks.length; y++) {
      if (x !== shortLen - eccLen || y >= nShort) all.push(blocks[y][x]);
    }

    var size = ver * 4 + 17;
    var mod = [], fn = [];
    for (var r = 0; r < size; r++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    function setFn(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

    for (var t = 0; t < size; t++) { setFn(6, t, t % 2 === 0); setFn(t, 6, t % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    var ap = [];
    if (ver > 1) {
      var na = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      ap = [6]; for (var p = size - 7; ap.length < na; p -= step) ap.splice(1, 0, p);
    }
    for (var i1 = 0; i1 < ap.length; i1++) for (var j1 = 0; j1 < ap.length; j1++) {
      if ((i1 === 0 && j1 === 0) || (i1 === 0 && j1 === ap.length - 1) || (i1 === ap.length - 1 && j1 === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) setFn(ap[i1] + dx2, ap[j1] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    function drawFormat(mask) {
      var d = (0 << 3) | mask; // ECC level M => format bits 00
      var rem = d; for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var bitsF = ((d << 10) | rem) ^ 0x5412;
      function g(i) { return ((bitsF >>> i) & 1) !== 0; }
      for (var i2 = 0; i2 <= 5; i2++) setFn(8, i2, g(i2));
      setFn(8, 7, g(6)); setFn(8, 8, g(7)); setFn(7, 8, g(8));
      for (var i3 = 9; i3 < 15; i3++) setFn(14 - i3, 8, g(i3));
      for (var i4 = 0; i4 < 8; i4++) setFn(size - 1 - i4, 8, g(i4));
      for (var i5 = 8; i5 < 15; i5++) setFn(8, size - 15 + i5, g(i5));
      setFn(8, size - 8, true);
    }
    drawFormat(0);
    if (ver >= 7) {
      var rem2 = ver; for (var q = 0; q < 12; q++) rem2 = (rem2 << 1) ^ ((rem2 >>> 11) * 0x1f25);
      var vb = (ver << 12) | rem2;
      for (var q2 = 0; q2 < 18; q2++) { var c = ((vb >>> q2) & 1) !== 0, a = size - 11 + q2 % 3, bb = Math.floor(q2 / 3); setFn(a, bb, c); setFn(bb, a, c); }
    }

    // zig-zag data placement
    var idx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        var xx2 = right - j, upward = ((right + 1) & 2) === 0, yy2 = upward ? size - 1 - vert : vert;
        if (!fn[yy2][xx2] && idx < all.length * 8) { mod[yy2][xx2] = ((all[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; }
      }
    }

    function applyMask(m) {
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
        var inv;
        switch (m) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = x * y % 2 + x * y % 3 === 0; break;
          case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
      }
    }
    function penalty() {
      var score = 0, dark = 0, x, y, run, prev;
      for (y = 0; y < size; y++) { run = 0; prev = null; for (x = 0; x < size; x++) { if (mod[y][x]) dark++; if (mod[y][x] === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else { run = 1; prev = mod[y][x]; } } }
      for (x = 0; x < size; x++) { run = 0; prev = null; for (y = 0; y < size; y++) { if (mod[y][x] === prev) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else { run = 1; prev = mod[y][x]; } } }
      for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) { var c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3; }
      var total = size * size; score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return score;
    }
    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var s = penalty(); if (s < bestScore) { bestScore = s; best = m; }
      applyMask(m); // undo
    }
    applyMask(best); drawFormat(best);
    return { size: size, modules: mod, version: ver };
  }

  function draw(canvas, text, px, fg, bg) {
    var qr = encode(text), quiet = 2, n = qr.size + quiet * 2;
    var scale = Math.max(1, Math.floor(px / n)), dim = n * scale;
    var dpr = 1; canvas.width = dim * dpr; canvas.height = dim * dpr;
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.imageRendering = 'pixelated';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = bg || '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = fg || '#000';
    for (var y = 0; y < qr.size; y++) for (var x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }

  root.QR = { encode: encode, draw: draw };
  if (typeof module !== 'undefined') module.exports = root.QR;
})(typeof window !== 'undefined' ? window : globalThis);
