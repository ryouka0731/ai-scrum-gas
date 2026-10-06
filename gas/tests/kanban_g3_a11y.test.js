const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

/**
 * G3（キーボード・アクセシビリティ）。DOM の属性と focus() の呼び先を DOM シムで検査する。
 * 実ブラウザでの焦点・見え方は gas/tests/browser/bughunt_e_fixed.test.js が主の守り。
 */

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: '題名A', updated_at: 'T1' },
                           { id: 'PBI-002', title: '題名B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const cmt = (id, at) => ({ id: id, target_id: 'PBI-001', author: 'me@example.com', created_at: at, body: id, mine: true });

function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 2, points: 0 } },
    comments: { 'PBI-001': [cmt('CMT-00000001', '2026-10-06 09:00:00'), cmt('CMT-00000002', '2026-10-06 10:00:00')] },
  });
  return h;
}
const cards = (h) => h.sandbox.document.querySelectorAll('#board .card');

test('E1: カードは tabindex=0・role=button で、名前に ID とタイトルを含む', () => {
  const h = ready();
  const list = cards(h);
  assert.equal(list.length, 2);
  list.forEach((c) => {
    assert.equal(c.getAttribute('tabindex'), '0');
    assert.equal(c.getAttribute('role'), 'button');
  });
  assert.equal(list[0].getAttribute('aria-label'), 'PBI-001 題名A');
});

test('E1: カードで Enter / Space を押すとパネルが開く。他のキーでは開かない', () => {
  const h = ready();
  const card = () => cards(h)[0];
  let prevented = 0;
  const key = (k) => card().listeners.keydown.forEach((fn) => fn.call(card(), { key: k, target: card(), preventDefault: () => { prevented++; } }));
  key('a');
  assert.equal(h.hiddenOf('panel'), true);
  key('Enter');
  assert.equal(h.hiddenOf('panel'), false);
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('panel'), true);
  key(' ');
  assert.equal(h.hiddenOf('panel'), false);
  assert.equal(prevented, 2, 'Space / Enter は既定動作（スクロール）を止める');
});

test('E2: カードから開いたパネルを Escape で閉じると、そのカードへ焦点が戻る', () => {
  const h = ready();
  h.openCard('PBI-002');
  const before = cards(h).map((c) => c.focusCount);
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('panel'), true);
  const after = cards(h);
  assert.equal(after[1].focusCount > 0, true, '開いた元のカードに focus() が呼ばれる');
  assert.equal(after[0].focusCount, 0);
  assert.equal(before.length, 2);
});

test('E2: 閉じるボタンでも、追加ボタンから開いたときは追加ボタンへ戻る', () => {
  const h = ready();
  h.clickAdd('New');
  h.click('panel-close');
  const adds = h.sandbox.document.querySelectorAll('#board .add');
  assert.equal(adds[0].focusCount, 1);
});

test('E5: PBI の削除は「PBI を削除」、コメントの削除は書き手と日時入りの名前になり、重複しない', () => {
  const h = ready();
  h.openCard('PBI-001');
  assert.equal(h.sandbox.document.getElementById('panel-delete').getAttribute('aria-label'), 'PBI を削除');
  const dels = h.sandbox.document.querySelectorAll('#panel-comments .comment-delete');
  assert.equal(dels.length, 2);
  const names = dels.map((d) => d.getAttribute('aria-label'));
  assert.match(names[0], /^me のコメントを削除/);
  assert.notEqual(names[0], names[1]);
});

test('E3: コメントを消すと、次のコメントの削除ボタンへ焦点が移る', () => {
  const h = ready();
  h.openCard('PBI-001');
  const dels = () => h.sandbox.document.querySelectorAll('#panel-comments .comment-delete');
  const first = dels()[0];
  first.focus();   // 実際に押すとそのボタンに焦点がある
  first.listeners.click.forEach((fn) => fn.call(first, {}));
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiDeleteComment');
  call.handlers.success({
    ok: true, removed: cmt('CMT-00000001', '2026-10-06 09:00:00'),
    comments: { 'PBI-001': [cmt('CMT-00000002', '2026-10-06 10:00:00')] },
  });
  const rest = dels();
  assert.equal(rest.length, 1);
  assert.equal(rest[0].focusCount, 1, '残った（次の）コメントの削除ボタンに焦点');
});

test('E3: 最後の1件を消したら入力欄へ焦点が移る', () => {
  const h = ready();
  h.openCard('PBI-001');
  const dels = h.sandbox.document.querySelectorAll('#panel-comments .comment-delete');
  // 先に1件目を消し終えて、2件目だけにしてから消す
  dels[0].focus();
  dels[0].listeners.click.forEach((fn) => fn.call(dels[0], {}));
  h.calls[h.calls.length - 1].handlers.success({ ok: true, removed: cmt('CMT-00000001', '2026-10-06 09:00:00'),
    comments: { 'PBI-001': [cmt('CMT-00000002', '2026-10-06 10:00:00')] } });
  const last = h.sandbox.document.querySelectorAll('#panel-comments .comment-delete')[0];
  const input = h.sandbox.document.querySelectorAll('#panel-comments .comment-input')[0];
  const before = input.focusCount;
  last.focus();
  last.listeners.click.forEach((fn) => fn.call(last, {}));
  h.calls[h.calls.length - 1].handlers.success({ ok: true, removed: cmt('CMT-00000002', '2026-10-06 10:00:00'),
    comments: { 'PBI-001': [] } });
  assert.equal(input.focusCount, before + 1);
});
