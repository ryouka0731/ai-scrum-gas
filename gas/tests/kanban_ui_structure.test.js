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
