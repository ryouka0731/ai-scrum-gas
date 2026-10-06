'use strict';
// 2巡目のバグ探し H1（サーバー・pure 側）の修正確認。各テストは bughunt2_{S,V,P}_failing.test.js.txt の再現を移したもの。
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./bughunt2_S_harness.js');
const plain = H.plain;

// --- S2: 利用者が書ける値に効く正規表現が、長い入力で二乗時間にならない ---------------------------------

function timeIt(fn) {
  const t = Date.now();
  fn();
  return Date.now() - t;
}

test('S-BUG-2a: シートへの無害化（escapeSheetCell）が、- と長い数字の並びで二乗時間にならない', () => {
  const E = require('../pure_sheet_escape.js');
  const shapes = [
    '-' + '1'.repeat(40000) + 'x',
    '-' + '1'.repeat(20000) + '.' + '1'.repeat(20000) + 'x',
    '-1e' + '1'.repeat(40000) + 'x',
    '-1' + ' '.repeat(40000) + 'x',
    ' '.repeat(40000) + '-x',
  ];
  shapes.forEach((s) => {
    const ms = timeIt(() => E.escapeSheetCell(s));
    assert.ok(ms < 100, 'escapeSheetCell が ' + ms + 'ms かかった（長さ ' + s.length + '）');
    assert.equal(E.escapeSheetCell(s), "'" + s, '数値でない値は無害化する');
  });
});

test('S-BUG-2a: 数値だけの文字列の扱いは変わらない', () => {
  const E = require('../pure_sheet_escape.js');
  ['-3', '+1.5', '-1e3', '-.5', ' -2 ', '-1.', '+1.5E-3', '-' + '9'.repeat(40000)].forEach((s) => assert.equal(E.escapeSheetCell(s), s, s));
  ['-', '-.', '-e3', '-1e', '-1.2.3', '=1', '+1x', '- 1', '@1'].forEach((s) => assert.equal(E.escapeSheetCell(s), "'" + s, s));
});

test('S-BUG-2b: スプリント名の正規化（normalizeSprint）が、長い数字の並び＋末尾の非数字で二乗時間にならない', () => {
  const F = require('../pure_filter.js');
  const s = '1'.repeat(40000) + 'x';
  const ms = timeIt(() => F.normalizeSprint(s));
  assert.ok(ms < 100, 'normalizeSprint が ' + ms + 'ms かかった（/^(.*?)(\\d+)$/ のバックトラック）');
  assert.equal(F.normalizeSprint(s), s);
});

test('S-BUG-2b: normalizeSprint の結果は変わらない', () => {
  const F = require('../pure_filter.js');
  assert.equal(F.normalizeSprint('Sprint 001'), 'sprint001');
  assert.equal(F.normalizeSprint('sprint1'), 'sprint001');
  assert.equal(F.normalizeSprint('Sprint-12'), 'sprint012');
  assert.equal(F.normalizeSprint('sprint1234'), 'sprint1234');
  assert.equal(F.normalizeSprint('7'), '007');
  assert.equal(F.normalizeSprint('a1b22'), 'a1b022');
  assert.equal(F.normalizeSprint('abc'), 'abc');
  assert.equal(F.normalizeSprint(''), '');
  assert.equal(F.normalizeSprint(null), '');
});

test('S-BUG-2c: 1回の apiUpdatePbi で入れたスプリント値で、全員の盤面の読み込み（apiGetView board）が遅くならない', () => {
  const h = H.createCtx(H.baseFiles());
  const u = plain(h.ctx.apiUpdatePbi('PBI-001', { title: 'A', sprint: '1'.repeat(40000) + 'x' }, '2026-10-01 00:00:00'));
  assert.equal(u.ok, true, '前提: 長いスプリント値が受け付けられる');
  let v;
  const ms = timeIt(() => { v = plain(h.ctx.apiGetView('board')); });
  assert.equal(v.ok, true);
  assert.ok(ms < 200, '盤面の読み込みに ' + ms + 'ms（sprintChoices → normalizeSprint）');
});

// --- V1: 全角括弧だけで囲んだ PBI のタイトルは、雛形の行と見分けられないので拒否する --------------------

const V = require('./bughunt2_V_env.js');
const VT = '2026-01-01 00:00:00';
function vEnv() {
  return V.makeEnv({ files: { 'product_backlog.csv': V.BACKLOG_HEADER + 'PBI-001,A,,,Low,1,New,,' + VT + ',' + VT + '\n', 'product_backlog_done.csv': V.BACKLOG_HEADER }, folders: {} });
}
const boardIds = (board) => [].concat.apply([], V.J(board).columns.map((c) => c.cards.map((x) => x.id)));
const V1_MSG = 'タイトルを（）だけで囲まないでください。雛形の行と見分けられなくなります。';

test('BUG-V1: 全角括弧だけで囲んだタイトルで PBI を作ると invalid で断る（成功と返して盤面から消さない）', () => {
  const e = vEnv();
  const before = e.scrumSpec.files['product_backlog.csv'];
  const r = V.J(e.ctx.apiCreatePbi({ title: ' （仮） ', priority: 'Low' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message, V1_MSG);
  assert.equal(e.scrumSpec.files['product_backlog.csv'], before, '書いていない');
});

test('BUG-V1b: 既存の PBI のタイトルを（…）だけで囲む保存は invalid で断る。PBI は盤面に残る', () => {
  const e = vEnv();
  const r = V.J(e.ctx.apiUpdatePbi('PBI-001', { title: '（旧）', priority: 'Low', status: 'New', size: '1' }, VT));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.ok(boardIds(e.ctx.apiGetView('board').view).indexOf('PBI-001') !== -1);
});

test('BUG-V1: 括弧が途中にあるだけのタイトル・片側だけのタイトルは通す', () => {
  const pv = require('../pure_pbi_validate.js');
  ['（仮）の件', '件（仮）', '（', '）', 'A（B）C'].forEach((t) => assert.equal(pv.validatePbiFields({ title: t }, ['New']).ok, true, t));
  assert.deepEqual(pv.validatePbiFields({ title: '（）' }, ['New']).errors, [V1_MSG]);
});

// --- V2: 配布（scripts/publish.js）は、配布記録 .published.json をリンク越しに書かない ---------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish.js');
function vTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-V-publish-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function runPublish(arg) {
  const r = spawnSync(process.execPath, [SCRIPT, arg], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

test('BUG-V2: 配布先の scrum/ がリンクのとき、配布記録（.published.json）をリンク先（配布フォルダの外）へ書かない', () => {
  const t = vTmp();
  const outside = vTmp();
  try {
    fs.symlinkSync(outside.dir, path.join(t.dir, 'scrum'));
    const r = runPublish(t.dir);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(fs.readdirSync(outside.dir), [], 'リンク先に書き込んだ');
    assert.match(r.err, /通常のフォルダではないため/);
    assert.match(r.out, /リンク・通常でないファイルをスキップ/);
    assert.match(r.err, /配布記録（\.published\.json）を書きませんでした/);
    assert.doesNotMatch(r.out, /配布記録: /);
  } finally { t.cleanup(); outside.cleanup(); }
});

test('BUG-V2b: 配布先の scrum/.published.json がリンクのとき、リンク先の既存ファイル（配布フォルダの外）を上書きしない', () => {
  const t = vTmp();
  const outside = vTmp();
  try {
    fs.mkdirSync(path.join(t.dir, 'scrum'));
    const victim = path.join(outside.dir, 'victim.txt');
    fs.writeFileSync(victim, '大事な内容');
    fs.symlinkSync(victim, path.join(t.dir, 'scrum', '.published.json'));
    const r = runPublish(t.dir);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(victim, 'utf8'), '大事な内容', 'リンク先の外部ファイルが上書きされた');
    assert.ok(fs.lstatSync(path.join(t.dir, 'scrum', '.published.json')).isSymbolicLink(), 'リンク自体も触らない');
    assert.match(r.err, /配布記録（\.published\.json）を書きませんでした/);
  } finally { t.cleanup(); outside.cleanup(); }
});
