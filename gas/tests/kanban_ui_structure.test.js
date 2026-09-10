const test = require('node:test');
const assert = require('node:assert/strict');
const { styleSource, scriptSource } = require('./kanban_harness.js');

/**
 * kanban.html の静的構造を見る検査。
 *
 * kanban_flow.test.js のシムは CSS を評価しない（display の打ち消し等と同じ理由）。
 * ここは <style> / <script> の文字列そのものを対象にする。
 */

test('ブラウザのモーダル (alert / confirm / prompt) を使っていない', () => {
  // モーダルは操作を中断させ、取り消しの手段も与えない。うちは「モーダルを使わない」が
  // 中核方針（delete は通知バナー + 取り消しで受ける）。window.alert( / alert( の
  // どちらの書き方でも検出する。
  const js = scriptSource();
  const found = js.match(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/g) || [];
  assert.deepEqual(found, []);
});

/**
 * <style> のうち、var(--token) で参照されているのに定義されていないトークン名を返す。
 *
 * コメントを先に除去してから走査する。除去しないと、コメント中の `--foo: ...` が
 * そのまま「定義済み」として拾われ、コメントにしか書いていないトークンへの参照が
 * 素通りしてしまう（下の回帰検査で再現している）。
 */
function findUndefinedTokens(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // kanban.html は1行に複数のトークンを並べて定義する（--bg: ...; --card: ...; ...）ため、
  // 行頭アンカー (^) では2つ目以降を取りこぼす。行内の位置を問わず --name: の形を拾う。
  const defined = new Set();
  const defRe = /(--[a-z0-9-]+):/g;
  let m;
  while ((m = defRe.exec(stripped)) !== null) defined.add(m[1]);

  const used = new Set();
  const useRe = /var\((--[a-z0-9-]+)/g;
  while ((m = useRe.exec(stripped)) !== null) used.add(m[1]);

  return [...used].filter((name) => !defined.has(name));
}

test('<style> が参照するトークンはすべて定義されている', () => {
  // kanban.html は優先度のドットを 'var(--prio-' + card.priority + ')' と
  // 動的に組み立てて描く（1件、priority のドット描画のみ）。CSS 側の文字列に
  // 現れないため、この検査では原理的に検出できない。
  assert.deepEqual(findUndefinedTokens(styleSource()), []);
});

test('コメントに書いただけのトークンを定義として扱わない', () => {
  // 上の検査の検出漏れの回帰。コメント除去を忘れると、コメント中の --zzz: を
  // 「定義済み」として拾ってしまい、実際には定義の無い参照を見逃す。
  const css = '/* あとで --zzz: 1px を足す */\n.x { width: var(--zzz); }';
  assert.deepEqual(findUndefinedTokens(css), ['--zzz']);
});

// ---------------------------------------------------------------------------
// 「読み込み中」の会計は3者だけのもの
//
// 不変条件: tableLoading が true であることと、#table-view に読み込み中の
// placeholder が出ていることは、常に一致する。
//
// 一致が崩れたときの見え方は kanban_view.test.js が全手番で照合している。ただし
// 今の呼び出しグラフでは、実データが入るのが必ず renderTable()（そこで tableLoading は
// 必ず false に戻る）なので、foldTableLoading() の後始末を落としても画面差が出ない
// ＝振る舞いからは観測できない。呼び出し元が増えれば観測できるようになる（＝不具合になる）。
//
// そこで、不変条件が成り立つための前提そのものを源で見る:
// 「#table-view の中身と tableLoading を触るのは、この3者だけ」。
// ---------------------------------------------------------------------------

/** kanban.html の <script> から関数1つの本文を切り出す（入れ子の {} を数える）。 */
function functionBody(js, name) {
  const at = js.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, name + ' が見つかりません');
  const open = js.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) return js.slice(open, i + 1); }
  }
  throw new Error(name + ' の本文を切り出せません');
}

/** 「読み込み中」の会計を持つ3者。これ以外は #table-view の中身も tableLoading も触らない。 */
const TABLE_LOADING_OWNERS = ['showTableLoading', 'renderTable', 'foldTableLoading'];

test('tableLoading を書き換えるのは、placeholder を立てる／実データを描く／畳む の3者だけ', () => {
  // 3者のどれか1つでも後始末を落とすと、「true なのに placeholder が無い」
  // （あるいはその逆）の状態が残り、次に畳むときに実データを消しうる。
  const js = scriptSource();
  // 宣言（var tableLoading = false;）は初期値なので数に入れない。
  const writes = function (text) {
    return (text.match(/(?:^|[^.\w])(var\s+)?tableLoading\s*=[^=]/gm) || [])
      .filter(function (m) { return !/\bvar\s/.test(m); }).length;
  };
  assert.equal((js.match(/\bvar\s+tableLoading\s*=/g) || []).length, 1, 'tableLoading の宣言が1つではない');
  assert.equal(writes(js), TABLE_LOADING_OWNERS.length,
    'tableLoading への代入が ' + TABLE_LOADING_OWNERS.length + ' か所ではない（会計の持ち主が増減した）');

  TABLE_LOADING_OWNERS.forEach(function (name) {
    assert.equal(writes(functionBody(js, name)), 1,
      name + ' が tableLoading をちょうど1回書き換えていない');
  });
});

test('#table-view の中身を変えるのは、その3者だけ', () => {
  // placeholder が出ているかどうかを tableLoading で覚えている以上、その3者以外が
  // 中身を差し替えると、覚えている内容と実際の中身がずれる。
  const js = scriptSource();
  const hostRe = /getElementById\('table-view'\)/g;
  const owners = TABLE_LOADING_OWNERS.map(function (n) { return functionBody(js, n); });
  // showView() は hidden を切り替えるだけ（中身は触らない）。ここだけは例外として認める。
  const showView = functionBody(js, 'showView');
  assert.equal(/getElementById\('table-view'\)\.hidden\s*=/.test(showView), true,
    'showView が #table-view の hidden を切り替えていない');
  assert.equal((showView.match(hostRe) || []).length, 1,
    'showView が #table-view を hidden の切替以外で触っている');

  const total = (js.match(hostRe) || []).length;
  const inOwners = owners.reduce(function (n, body) { return n + (body.match(hostRe) || []).length; }, 0);
  assert.equal(total, inOwners + 1,
    '#table-view を触る場所が、3者と showView(hidden) 以外にもある');
});
