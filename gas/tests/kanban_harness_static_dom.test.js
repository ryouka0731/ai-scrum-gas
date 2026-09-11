const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStaticElements, isHidden } = require('./kanban_harness.js');

/**
 * kanban.html の振る舞いではなく、シム自身（kanban_harness.js）の静的 DOM 構築を
 * 直接検査する。fireVisible() が「実ブラウザでは display: none で触れない」と
 * 判定できるのは、id を持たない祖先の hidden も含めて isHidden() が正しく祖先を
 * 辿れているときだけ。id 付き要素だけを Element にしていた頃は、id の無い祖先を
 * 飛ばして親子を結んでいたため、その祖先の hidden を isHidden() が見落としていた
 * （今の kanban.html では hidden が付く要素が `#table-view`/`#panel`/`#toast` の
 * 3つとも id 付きなので実害は無いが、`<div hidden><button id="x">` のような
 * 構造が増えた瞬間にシムだけが実ブラウザとずれる）。
 */

test('id を持たない祖先の hidden も、isHidden() の祖先探索に届く', () => {
  const byId = parseStaticElements('<div hidden><span><button id="x">Y</button></span></div>');
  assert.ok(byId.x, '#x が見つかりません（テストの markup 自体を確認）');
  assert.equal(isHidden(byId.x), true,
    'id の無い祖先（<div hidden>）の hidden が isHidden() に届いていない');
});

test('id を持たない祖先が無ければ、hidden ではないと判定する（回帰）', () => {
  const byId = parseStaticElements('<div><span><button id="x">Y</button></span></div>');
  assert.equal(isHidden(byId.x), false, '隠れていない要素を隠れていると誤判定している');
});

test('id を持つ祖先の hidden は、従来どおり isHidden() に届く', () => {
  const byId = parseStaticElements('<div id="host" hidden><button id="x">Y</button></div>');
  assert.equal(isHidden(byId.x), true, '#host の hidden が #x に届いていない');
});
