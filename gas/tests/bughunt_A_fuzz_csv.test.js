'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, csvToObjects } = require('../pure_csv.js');
const { toCsv } = require('../pure_csv_write.js');
const { escapeSheetCell, escapeSheetGrid } = require('../pure_sheet_escape.js');
const { assertHeaderMatches } = require('../pure_backlog_header.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ATOMS = [',', '"', '""', '\r', '\n', '\r\n', '\t', '﻿', '😀', '\uD83D', '　', ' ', '  ', '',
  '=', '+', '-', '@', 'a', 'b', 'あ', 'x,y', '"q"', '=1+1', '-1', '\\', "'", ' ', '\u0000'];
function rndStr(r) {
  const n = Math.floor(r() * 6);
  let s = '';
  for (let i = 0; i < n; i++) s += ATOMS[Math.floor(r() * ATOMS.length)];
  if (r() < 0.03) s += 'z'.repeat(5000);
  return s;
}
const norm = s => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

test('round trip: csvToObjects(toCsv(rows)) === rows (CR normalized), 2+ columns', () => {
  const seed = 12345; const r = mulberry32(seed);
  for (let it = 0; it < 2000; it++) {
    const nf = 2 + Math.floor(r() * 4);
    const fields = []; for (let i = 0; i < nf; i++) fields.push('f' + i);
    const rows = [];
    const nr = 1 + Math.floor(r() * 5);
    for (let i = 0; i < nr; i++) { const o = {}; fields.forEach(f => { o[f] = rndStr(r); }); rows.push(o); }
    const back = csvToObjects(toCsv(rows, fields));
    const expect = rows.map(o => { const e = {}; fields.forEach(f => { e[f] = norm(o[f]); }); return e; });
    assert.deepStrictEqual(back, expect, 'seed=' + seed + ' it=' + it + ' rows=' + JSON.stringify(rows));
  }
});

test('toCsv never changes row count (2+ columns)', () => {
  const r = mulberry32(777);
  for (let it = 0; it < 1000; it++) {
    const fields = ['a', 'b'];
    const nr = Math.floor(r() * 6);
    const rows = []; for (let i = 0; i < nr; i++) rows.push({ a: rndStr(r), b: rndStr(r) });
    assert.strictEqual(parseCsv(toCsv(rows, fields)).length, nr + 1, 'it=' + it + JSON.stringify(rows));
  }
});

test('parse robustness: BOM / CRLF / LF / trailing newline equivalent', () => {
  const base = 'a,b\n1,2\n3,4';
  const variants = [base, base + '\n', '﻿' + base, base.replace(/\n/g, '\r\n') + '\r\n', base.replace(/\n/g, '\r')];
  const exp = [{ a: '1', b: '2' }, { a: '3', b: '4' }];
  variants.forEach(v => assert.deepStrictEqual(csvToObjects(v), exp, JSON.stringify(v)));
});

test('parse robustness: empty last field, quoted empty, header-only, unterminated quote', () => {
  assert.deepStrictEqual(csvToObjects('a,b\n1,'), [{ a: '1', b: '' }]);
  assert.deepStrictEqual(csvToObjects('a,b\n"",""\n'), [{ a: '', b: '' }]);
  assert.deepStrictEqual(csvToObjects('a,b\n'), []);
  assert.deepStrictEqual(csvToObjects('a,b'), []);
  assert.deepStrictEqual(csvToObjects(''), []);
  assert.doesNotThrow(() => parseCsv('a,b\n"1,2\n3,4'));
  assert.strictEqual(parseCsv('a,b\n"1,2\n3,4').length, 2);
});

test('fewer columns than header pad with empty string', () => {
  assert.deepStrictEqual(csvToObjects('a,b,c\n1'), [{ a: '1', b: '', c: '' }]);
});

test('escapeSheetCell: formulas escaped, numbers and non-strings untouched', () => {
  for (const v of ['=1+1', '+SUM(A1)', '-cmd', '@x', ' =1', '　=1', '\t=1', '\n=1', '\r=1', '  -a', '=', '+', '-']) {
    assert.strictEqual(escapeSheetCell(v), "'" + v, JSON.stringify(v));
  }
  for (const v of ['-3', '+1.5', '-1e3', '-.5', ' -3 ', '1', 'abc', '', "'=1"]) {
    assert.strictEqual(escapeSheetCell(v), v, JSON.stringify(v));
  }
  for (const v of [5, null, undefined, true, -1]) assert.strictEqual(escapeSheetCell(v), v);
});

test('escapeSheetCell: fuzz idempotent and never leaves a formula-leading string', () => {
  const r = mulberry32(99);
  for (let it = 0; it < 5000; it++) {
    const s = rndStr(r);
    const e = escapeSheetCell(s);
    assert.strictEqual(escapeSheetCell(e), e, 'not idempotent ' + JSON.stringify(s));
    if (e === s && /^\s*[=+\-@]/.test(s)) {
      assert.ok(/^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/.test(s), 'unescaped formula ' + JSON.stringify(s));
    }
  }
  assert.deepStrictEqual(escapeSheetGrid([['=a', 1], ['b']]), [["'=a", 1], ['b']]);
  assert.deepStrictEqual(escapeSheetGrid(null), []);
});

test('assertHeaderMatches', () => {
  const f = ['id', 'title'];
  assert.doesNotThrow(() => assertHeaderMatches('id,title\n1,x', f));
  assert.doesNotThrow(() => assertHeaderMatches('﻿id,title\r\n1,x', f));
  assert.doesNotThrow(() => assertHeaderMatches('id,title', f));
  for (const t of ['title,id\n', 'id,title,extra\n', 'id\n', 'id ,title\n', '', 'id,Title\n'])
    assert.throws(() => assertHeaderMatches(t, f), /列構成/, JSON.stringify(t));
});
