'use strict';
// バグ探し 2巡目 P: 規模・性能・計算量（サーバ層と純関数）。
//
// 方針: 実時間の絶対値は機械で変わるので、できるだけ「操作量」（Drive から読んだ/書いた文字数、CSV を解釈した
// 文字数、応答の大きさ）と「データを4倍にしたときの時間の比」で縛る。比は、線形（約4）と2乗（約16）の間に
// 大きな余裕（10）を取る。GAS の上限（6分の実行時間、ロック待ち10秒、google.script.run の応答の大きさ、
// Drive の setContent の大きさ）は、ここでは仮定として書く（コードからは確かめられない）。
// 実バグ（現状で落ちる期待）は bughunt2_P_failing.test.js.txt に分けてある。

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./bughunt2_P_support.js');

const pure = {
  csv: require('../pure_csv.js'),
  csvWrite: require('../pure_csv_write.js'),
  history: require('../pure_history.js'),
  comment: require('../pure_comment.js'),
  board: require('../pure_board_view.js'),
  list: require('../pure_view_backlog.js'),
  sprint: require('../pure_view_sprint.js'),
  imp: require('../pure_view_impediment.js'),
  options: require('../pure_sprint_options.js'),
  summary: require('../pure_summary.js'),
  gridBoard: require('../pure_grid_board.js'),
};

/**
 * n1 → 4×n1 でデータを増やしたとき、時間の比が maxRatio 以内（線形 ≈ 4、2乗 ≈ 16）。
 * GC の揺れで1回だけ外れることがあるので、最大3回測り直して、1回でも収まれば通す
 * （本物の2乗は毎回 16 前後になるので、3回とも外れる）。
 */
function assertNearLinear(name, make, n1, opts) {
  const o = opts || {};
  const factor = o.factor || 4;
  const maxRatio = o.maxRatio || 10;
  const a = make(n1);
  const b = make(n1 * factor);
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const t1 = Math.max(S.bestOf(a, 3), 1);   // 1ms 未満は揺れが主になるので下駄を履かせる
    const t2 = S.bestOf(b, 3);
    const ratio = t2 / t1;
    if (ratio <= maxRatio) return;
    last = name + ': データを' + factor + '倍にすると時間が ' + ratio.toFixed(1) + ' 倍（' + n1 + ' → ' + (n1 * factor) + '、'
      + t1.toFixed(1) + 'ms → ' + t2.toFixed(1) + 'ms）。線形なら約' + factor + '、2乗なら約' + factor * factor;
  }
  assert.fail(last + '（3回測っても外れた）');
}

function rowsN(n, opt) {
  const o = opt || {};
  const r = [];
  for (let i = 1; i <= n; i++) {
    r.push({ id: S.pid(i), title: 't' + i, description: 'd\n' + i, acceptance_criteria: 'a', priority: 'Medium', size: '3',
      status: S.STATUSES[i % 5], sprint: o.sprint ? o.sprint(i) : 'Sprint ' + (i % 40), created_at: S.T0, updated_at: S.T0 });
  }
  return r;
}

/** 先頭の PBI の updated_at（引用符つきの複数行を含むので、行分割ではなく CSV として読む）。 */
function firstUpdatedAt(c) {
  return pure.csv.csvToObjects(c.files['product_backlog.csv'])[0].updated_at;
}

// ---------------------------------------------------------------------------
// 1. サーバ: 1回の呼び出しの操作量
// ---------------------------------------------------------------------------

test('P1. 盤面・一覧: 各ファイルを Drive から1回だけ読み、読むのは必要なファイルだけ', () => {
  const files = S.standardFiles(1000, 1000, { logChars: 1000000 });
  const c = S.createCtx(files);
  ['board', 'list'].forEach((v) => {
    c.resetStats();
    const r = c.ctx.apiGetView(v);
    assert.equal(r.ok, true, v);
    Object.keys(c.stats.reads).forEach((name) => assert.equal(c.stats.reads[name], 1, v + ': ' + name + ' を ' + c.stats.reads[name] + ' 回読んでいる'));
    assert.equal(c.stats.reads['change_log.csv'], undefined, v + ': 履歴ファイルを読んでいる（ビューの応答に履歴は載せない）');
    assert.deepEqual(c.stats.writes, {}, v + ': 読み取りで書いている');
  });
});

test('P2. 書き込み（状態変更・作成・コメント）: 本体と履歴の2ファイルだけを1回ずつ読み書きし、履歴の既存行は解釈し直さない', () => {
  // 変更履歴は追記だけ。ファイルが大きくなっても CSV の解釈量が増えないこと（spec 第6段階「追記は既存の行を解釈し直さない」）。
  const files = S.standardFiles(1000, 1000, { logChars: 3000000 });
  const backlog = files['product_backlog.csv'].length;
  const comments = files['comments.csv'].length;
  const log = files['change_log.csv'].length;
  const c = S.createCtx(files);

  c.resetStats();
  const u = c.ctx.apiUpdateStatus(S.pid(1), 'Done', S.T0);
  assert.equal(u.ok, true, JSON.stringify(u).slice(0, 200));
  assert.deepEqual(Object.keys(c.stats.writes).sort(), ['change_log.csv', 'product_backlog.csv']);
  assert.equal(c.stats.writes['product_backlog.csv'], 1);
  assert.equal(c.stats.writes['change_log.csv'], 1);
  assert.equal(c.stats.reads['change_log.csv'], 1);
  // 履歴は 3MB だが、解釈した量には入らない（見出し行だけ）。本体は現状 3 回（見出し検査・列数検査・行へ）。
  assert.ok(c.stats.parsedChars <= 3.2 * backlog + 1000, '解釈した文字数 ' + c.stats.parsedChars + ' が本体の3.2倍（' + 3.2 * backlog + '）を超えた');
  // 履歴へ足した分は小さい（約100文字）。全部を書き直す量は log に比例するが、足す量は定数。
  assert.ok(c.stats.writeChars['change_log.csv'] - log < 1000, '履歴へ足した文字数が大きい: ' + (c.stats.writeChars['change_log.csv'] - log));

  c.resetStats();
  const cm = c.ctx.apiAddComment(S.pid(1), 'こんにちは');
  assert.equal(cm.ok, true, JSON.stringify(cm).slice(0, 200));
  assert.deepEqual(Object.keys(c.stats.writes).sort(), ['change_log.csv', 'comments.csv']);
  assert.ok(c.stats.parsedChars <= 3.2 * comments + 1000, 'コメントの解釈量 ' + c.stats.parsedChars);
});

test('P3. 書き込みのロック: 1回の書き込みで tryLock は1回（待ちを増やさない）', () => {
  const c = S.createCtx(S.standardFiles(200, 20));
  c.resetStats();
  c.ctx.apiUpdateStatus(S.pid(1), 'Ready', S.T0);
  assert.equal(c.stats.lockCalls, 1);
  c.resetStats();
  c.ctx.apiAddComment(S.pid(1), 'x');
  assert.equal(c.stats.lockCalls, 1);
});

test('P4. 履歴の読み取り: 履歴ファイルを1回だけ読み、返すのは200件以内。応答の大きさは履歴ファイルの大きさに依らない', () => {
  const small = S.createCtx(S.standardFiles(10, 0, { logChars: 20000 }));
  const big = S.createCtx(S.standardFiles(10, 0, { logChars: 5000000 }));
  const rs = small.ctx.apiGetHistory(S.pid(1));
  big.resetStats();
  const rb = big.ctx.apiGetHistory(S.pid(1));
  assert.equal(rb.ok, true);
  assert.equal(big.stats.reads['change_log.csv'], 1);
  assert.equal(big.stats.parseCalls, 1, '履歴を2回以上解釈している');
  assert.ok(rb.entries.length <= 200);
  assert.equal(rb.truncated, true);
  // 同じ種類の短い行なら、件数の上限で頭打ちになる（5MB でも 20KB の履歴の数十倍にはならない）。
  assert.ok(S.payloadChars(rb) < 60000, '履歴の応答 ' + S.payloadChars(rb) + ' 文字');
  assert.ok(rs.entries.length < rb.entries.length || rs.entries.length <= 200);
});

// ---------------------------------------------------------------------------
// 2. 応答の大きさ（google.script.run の直列化の目安。実際の上限は GAS 側の仮定: 数十 MB 未満でも
//    ブラウザの描画と転送が先に重くなる）
// ---------------------------------------------------------------------------

test('P5. 盤面の応答: PBI 1件あたり 600 文字以内（コメント無し）で、件数に線形', () => {
  const sizes = [1000, 4000].map((n) => {
    const c = S.createCtx(S.standardFiles(n, null));
    const r = c.ctx.apiGetView('board');
    assert.equal(r.ok, true);
    return S.payloadChars(r);
  });
  assert.ok(sizes[0] / 1000 <= 600, '1件あたり ' + sizes[0] / 1000);
  const ratio = sizes[1] / sizes[0];
  assert.ok(ratio > 3.5 && ratio < 4.5, '4倍にして応答は ' + ratio.toFixed(2) + ' 倍');
});

test('P6. 10,000 件の盤面: 応答は 4MB 未満、ロードマップは 1MB 未満、各ビューの応答が成功する', () => {
  const c = S.createCtx(S.standardFiles(10000, null));
  const b = c.ctx.apiGetView('board');
  const l = c.ctx.apiGetView('list');
  const rm = c.ctx.apiGetView('roadmap');
  assert.equal(b.ok && l.ok && rm.ok, true);
  assert.ok(S.payloadBytes(b) < 4e6, '盤面 ' + S.payloadBytes(b));
  assert.ok(S.payloadBytes(l) < 4e6, '一覧 ' + S.payloadBytes(l));
  assert.ok(S.payloadBytes(rm) < 1e6, 'ロードマップ ' + S.payloadBytes(rm));
});

test('P7. コメントの応答: ビューには対象ごとの件数だけが載る。コメントを4倍にしても盤面の応答はほぼ変わらない', () => {
  // 2巡目 H2（P2）で、全コメントを載せる設計から件数（commentCounts）だけを載せる設計に変えた。
  const bodyChars = 100;
  const make = (n) => {
    const c = S.createCtx(S.standardFiles(100, n, { bodyChars: bodyChars }));
    return S.payloadChars(c.ctx.apiGetView('board'));
  };
  const base = make(0);
  const a = make(1000) - base;
  const b = make(4000) - base;
  // 件数は最大 50 対象（standardFiles が散らす数）。1対象あたり数十文字以内。
  assert.ok(a <= 50 * 30, '1,000 件で ' + a + ' 文字増えた');
  assert.ok(b - a <= 50 * 2, '4,000 件にして ' + (b - a) + ' 文字増えた');
});

test('P8. 変更履歴の見出しだけの短い値なら、200件の応答は 100KB 未満（切り捨ては件数で効く）', () => {
  const c = S.createCtx(S.standardFiles(10, 0, { logChars: 1500000 }));
  const r = c.ctx.apiGetHistory(S.pid(1));
  assert.equal(r.entries.length, 200);
  assert.ok(S.payloadChars(r) < 100000, String(S.payloadChars(r)));
});

// ---------------------------------------------------------------------------
// 3. 計算量: データを4倍にしたときの時間の比
// ---------------------------------------------------------------------------

test('P9. CSV: parseCsv / csvToObjects / toCsv / csvEndsInsideQuotes / findOverlongCsvRow は線形', () => {
  const memo = {};
  const csvOf = (n) => memo[n] || (memo[n] = pure.csvWrite.toCsv(rowsN(n), S.BACKLOG_FIELDS));
  assertNearLinear('parseCsv', (n) => () => pure.csv.parseCsv(csvOf(n)), 2500);
  assertNearLinear('csvToObjects', (n) => () => pure.csv.csvToObjects(csvOf(n)), 2500);
  assertNearLinear('toCsv', (n) => { const r = rowsN(n); return () => pure.csvWrite.toCsv(r, S.BACKLOG_FIELDS); }, 2500);
  assertNearLinear('csvEndsInsideQuotes', (n) => () => pure.csv.csvEndsInsideQuotes(csvOf(n)), 10000);
  assertNearLinear('findOverlongCsvRow', (n) => () => pure.csv.findOverlongCsvRow(csvOf(n)), 2500);
});

test('P10. 引用符の中が巨大でも現実的な時間で解釈できる（1セル 約120万文字が 3秒未満）', () => {
  // 貼り付けられた長文（説明欄）を想定。V8 の文字列連結は大きいセルで少し線形を外れるので、比ではなく絶対値で縛る。
  const t = 'id,body\n1,"' + 'あ,\n'.repeat(400000) + '"\n';
  const ms = S.bestOf(() => pure.csv.parseCsv(t), 2);
  assert.ok(ms < 3000, ms.toFixed(0) + 'ms');
  assert.equal(pure.csv.parseCsv(t)[1][1].length, 1200000);
});

test('P11. diffRows（ID が重ならない行）: 1件だけ変わっても全件変わっても線形', () => {
  assertNearLinear('diffRows 1件変更', (n) => {
    const a = rowsN(n); const b = rowsN(n); b[0].title = 'x';
    return () => pure.history.diffRows(a, b, S.BACKLOG_FIELDS, ['updated_at', 'created_at']);
  }, 2500);
  assertNearLinear('diffRows 全件変更', (n) => {
    const a = rowsN(n); const b = rowsN(n); b.forEach((r) => { r.title = 'y'; });
    return () => pure.history.diffRows(a, b, S.BACKLOG_FIELDS, ['updated_at', 'created_at']);
  }, 2000);
});

test('P12. diffRows: 全行削除・全行作成も線形', () => {
  assertNearLinear('全削除', (n) => { const a = rowsN(n); return () => pure.history.diffRows(a, [], S.BACKLOG_FIELDS, []); }, 2500);
  assertNearLinear('全作成', (n) => { const a = rowsN(n); return () => pure.history.diffRows([], a, S.BACKLOG_FIELDS, []); }, 2500);
});

test('P13. historyFor / groupComments: 行数に線形（対象が1つに偏っても）', () => {
  const log = (n, one) => {
    const r = [];
    for (let i = 0; i < n; i++) {
      r.push({ id: 'CHG-' + i, at: '2026-01-01 00:' + String(i % 60).padStart(2, '0') + ':' + String((i * 7) % 60).padStart(2, '0'),
        actor: 'a', target_id: one ? 'PBI-1' : 'PBI-' + (i % 50), action: 'update', field: 'title', before: 'a', after: 'b' });
    }
    return r;
  };
  assertNearLinear('historyFor 分散', (n) => { const r = log(n, false); return () => pure.history.historyFor(r, 'PBI-1', 201); }, 20000);
  assertNearLinear('historyFor 1対象', (n) => { const r = log(n, true); return () => pure.history.historyFor(r, 'PBI-1', 201); }, 20000);
  const cm = (n, targets) => {
    const r = [];
    for (let i = 0; i < n; i++) r.push({ id: 'CMT-' + i, target_id: 'PBI-' + (1 + (i % targets)), author: 'a', created_at: '2026-01-01 00:00:' + (i % 60), body: 'b' });
    return r;
  };
  assertNearLinear('groupComments 50対象', (n) => { const r = cm(n, 50); return () => pure.comment.groupComments(r, 'a'); }, 10000);
  assertNearLinear('groupComments 1対象', (n) => { const r = cm(n, 1); return () => pure.comment.groupComments(r, 'a'); }, 10000);
});

test('P14. 盤面・一覧・要約・スプリント選択肢・ロードマップは行数に線形（スプリントが40本）', () => {
  const vel = [];
  for (let i = 0; i < 40; i++) vel.push({ sprint: 'Sprint ' + i, sprint_start: '2026-01-01', sprint_end: '2026-01-14' });
  assertNearLinear('buildBoardData', (n) => { const r = rowsN(n); return () => pure.board.buildBoardData(r); }, 2500);
  assertNearLinear('buildListView', (n) => { const r = rowsN(n); return () => pure.list.buildListView(r); }, 2500);
  assertNearLinear('summarizeBacklog', (n) => { const r = rowsN(n); return () => pure.summary.summarizeBacklog(r, pure.gridBoard.KANBAN_STATUSES); }, 2500);
  assertNearLinear('sprintChoices', (n) => { const r = rowsN(n); return () => pure.options.sprintChoices(vel, r); }, 2500);
  assertNearLinear('buildRoadmapView', (n) => { const r = rowsN(n); return () => pure.sprint.buildRoadmapView(r, vel); }, 2500);
});

test('P15. 障害物のビュー: 解決済が増えても（未解決は少数）線形', () => {
  const imp = (k, tag) => {
    const r = [];
    for (let i = 0; i < k; i++) r.push({ id: 'IMP-' + tag + String(i).padStart(5, '0'), title: 't', description: 'd', reported_by: 'a', reported_at: '2026-01-01', status: 'x', resolved_at: '', resolution: '', sprint: '' });
    return r;
  };
  const open = imp(50, 'o');
  assertNearLinear('buildImpedimentView 解決済が増える', (n) => { const r = imp(n, 'r'); return () => pure.imp.buildImpedimentView(open, r); }, 2500);
});

test('P16. lineDiff: 500行×500行（全部違う・全部同じ）は 2秒未満で、行数を2倍にすると約4倍（LCS の表で2乗は設計どおり）', () => {
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => tag + i).join('\n');
  const worst = S.bestOf(() => pure.history.lineDiff(lines(500, 'a'), lines(500, 'b')), 3);
  const same = S.bestOf(() => pure.history.lineDiff(lines(500, 'a'), lines(500, 'a')), 3);
  assert.ok(worst < 2000, '全部違う ' + worst.toFixed(0) + 'ms');
  assert.ok(same < 2000, '全部同じ ' + same.toFixed(0) + 'ms');
  // 上限（500行）を超えると LCS を使わない（丸ごと del/add）。501 行の方が速いか同程度。
  const over = S.bestOf(() => pure.history.lineDiff(lines(501, 'a'), lines(501, 'b')), 3);
  assert.ok(over < worst * 2 + 20, '501行（丸ごと）が 500行（LCS）より遅い: ' + over.toFixed(0) + ' vs ' + worst.toFixed(0));
});

test('P17. lineDiff の結果の大きさ: 行数の合計以内（500×500 でも 1000 件を超えない）', () => {
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => tag + i).join('\n');
  [[500, 500], [500, 1], [1, 500], [300, 450]].forEach(([n, m]) => {
    const d = pure.history.lineDiff(lines(n, 'a'), lines(m, 'b'));
    assert.ok(d.length <= n + m, n + 'x' + m + ' → ' + d.length);
    assert.equal(d.filter((x) => x.op !== 'add').length, n);
    assert.equal(d.filter((x) => x.op !== 'del').length, m);
  });
});

// ---------------------------------------------------------------------------
// 4. サーバ全体（vm の GAS コード）: データを4倍にしたときの時間の比
// ---------------------------------------------------------------------------

test('P18. apiGetView(board/list/roadmap/done) とコメント・履歴: 件数に線形', () => {
  const view = (name, n, cmts) => {
    const files = S.standardFiles(n, cmts === undefined ? null : cmts);
    files['product_backlog_done.csv'] = S.pbiCsv(n);
    const c = S.createCtx(files);
    return () => { const r = c.ctx.apiGetView(name); if (!r.ok) throw new Error(r.message); };
  };
  ['board', 'list', 'roadmap', 'done'].forEach((v) => assertNearLinear('apiGetView ' + v, (n) => view(v, n), 600));
  // 2巡目 H2（P2）から盤面はコメントの件数だけを数える（1件あたりの仕事が小さい）。600 件では 2ms 弱で揺れが
  // 主になるため、起点を 2,000 件にする（比べるのは同じく 4 倍にしたときの時間の比）。
  assertNearLinear('apiGetView board コメント', (n) => view('board', 100, n), 2000);
  assertNearLinear('apiGetHistory', (n) => {
    const c = S.createCtx(S.standardFiles(10, 0, { logChars: n * 1000 }));
    return () => c.ctx.apiGetHistory(S.pid(1));
  }, 500);
});

test('P19. 書き込み API（状態・編集・コメント追加）: 本体の件数と履歴の大きさに線形', () => {
  assertNearLinear('apiUpdatePbi 件数', (n) => {
    const c = S.createCtx(S.standardFiles(n, null));
    let k = 0;
    return () => { const r = c.ctx.apiUpdatePbi(S.pid(1), { title: 't' + (k++) }, firstUpdatedAt(c)); if (!r.ok) throw new Error(r.message); };
  }, 250);
  assertNearLinear('apiUpdatePbi 履歴の大きさ', (n) => {
    const c = S.createCtx(S.standardFiles(100, null, { logChars: n * 1000 }));
    let k = 0;
    return () => { const r = c.ctx.apiUpdatePbi(S.pid(1), { title: 't' + (k++) }, firstUpdatedAt(c)); if (!r.ok) throw new Error(r.message); };
  }, 250);
  assertNearLinear('apiAddComment 件数', (n) => {
    const c = S.createCtx(S.standardFiles(100, n));
    return () => { const r = c.ctx.apiAddComment(S.pid(1), 'hi'); if (!r.ok) throw new Error(r.message); };
  }, 250);
});

test('P20. 完了バックログが大きくても、盤面の読み取りは完了バックログを読まない', () => {
  const files = S.standardFiles(50, null);
  files['product_backlog_done.csv'] = S.pbiCsv(20000);
  const c = S.createCtx(files);
  c.resetStats();
  assert.equal(c.ctx.apiGetView('board').ok, true);
  assert.equal(c.stats.reads['product_backlog_done.csv'], undefined);
  c.resetStats();
  assert.equal(c.ctx.apiGetView('roadmap').ok, true);
  assert.equal(c.stats.reads['product_backlog_done.csv'], undefined);
});

test('P21. 完了ビュー: 20,000 件でも成功し、1件あたり 400 文字以内', () => {
  const files = S.standardFiles(10, null);
  files['product_backlog_done.csv'] = S.pbiCsv(20000);
  const c = S.createCtx(files);
  const r = c.ctx.apiGetView('done');
  assert.equal(r.ok, true);
  assert.equal(r.view.rows.length, 20000);
  assert.ok(S.payloadChars(r) / 20000 <= 400, String(S.payloadChars(r) / 20000));
});

test('P22. 書き込みの前後で件数が増えない・変わらない（100件 → 1000件の作成を繰り返しても ID は一意で、行は欠けない）', () => {
  const c = S.createCtx(S.standardFiles(100, null));
  const seen = new Set();
  const make = (i) => ({ title: 'n' + i, description: '', acceptance_criteria: '', status: 'New', priority: 'Medium', size: '', sprint: '' });
  for (let i = 0; i < 60; i++) {
    const r = c.ctx.apiCreatePbi(make(i));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.equal(seen.has(r.id), false, '重複した ID ' + r.id);
    seen.add(r.id);
  }
  const rows = pure.csv.csvToObjects(c.files['product_backlog.csv']);
  assert.equal(rows.length, 160);
  assert.equal(new Set(rows.map((x) => x.id)).size, 160);
});

test('P23. 変更履歴の追記は、履歴が 1,000,000 文字を超えても成功し、警告だけを返す（本体は書ける）', () => {
  const files = S.standardFiles(20, null, { logChars: 1200000 });
  const c = S.createCtx(files);
  const r = c.ctx.apiUpdateStatus(S.pid(1), 'Done', S.T0);
  assert.equal(r.ok, true);
  assert.match(r.historyWarning, /大きくなっています/);
  assert.match(files['product_backlog.csv'], /PBI-00001,[\s\S]*?,Done,/);
});
