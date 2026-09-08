const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, styleRules, selectorList, declarations } = require('./kanban_harness.js');

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const fmt = (cols) => cols.map(c => c.status + ':' + c.cards.join(',')).join(' | ');

/** 初期読み込みを済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  h.calls.length = 0;
  return h;
}

test('編集の応答が、送信中の別カードの移動を巻き戻さない', () => {
  // 応答の board は「サーバがその要求を処理した時点」のもので、後から確定した
  // ドラッグの移動を含まない。全体を信じると取り消したはずの移動が復活する。
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.openCard('PBI-002');
  h.setValue('f-title', 'B かいへん');
  h.click('panel-save');

  const save = h.calls[h.calls.length - 1];
  assert.equal(save.method, 'apiUpdatePbi');

  // 編集だけ先に返る。この board に PBI-001 の移動は入っていない。
  save.handlers.success({ ok: true, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                             { id: 'PBI-002', title: 'B かいへん', updated_at: 'T2' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  const cols = h.screen();
  assert.equal(cols[1].cards.indexOf('PBI-001') !== -1, true,
    'PBI-001 が New へ巻き戻された（送信中の移動が消えた）');
});

test('作成の応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.clickAdd('Done');
  h.setValue('f-title', 'あたらしい');
  h.click('panel-save');

  const create = h.calls[h.calls.length - 1];
  assert.equal(create.method, 'apiCreatePbi');
  assert.equal(create.args[0].status, 'Done', '列の文脈がステータスに入っていない');

  create.handlers.success({ ok: true, id: 'PBI-003', board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                             { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] },
    { status: 'Done', cards: [{ id: 'PBI-003', title: 'あたらしい', updated_at: 'T2' }] },
  ]) });

  const cols = h.screen();
  assert.ok(cols[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(cols[4].cards.indexOf('PBI-003') !== -1, '作った PBI が出ていない');
});

test('削除の応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  const del = h.calls[h.calls.length - 1];
  assert.equal(del.method, 'apiDeletePbi');

  del.handlers.success({ ok: true, removed: { id: 'PBI-002', title: 'B' }, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  const cols = h.screen();
  assert.ok(cols[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.equal(cols[0].cards.indexOf('PBI-002'), -1, '消したカードが残っている');
});

test('削除に確認ダイアログを挟まず、即座に送信する', () => {
  // モーダルは操作を制限し順序を固定するため置かない（フェイルセーフで受ける）。
  const h = ready();
  h.openCard('PBI-001');
  const before = h.calls.length;
  h.click('panel-delete');
  assert.equal(h.calls.length, before + 1, '削除が送信されていない');
  assert.equal(h.calls[before].method, 'apiDeletePbi');
});

test('削除のあと通知から取り消せ、元の ID のまま戻る', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  const removed = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };
  h.calls[h.calls.length - 1].handlers.success({ ok: true, removed: removed, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  assert.equal(h.hiddenOf('toast'), false, '取り消しの通知が出ていない');
  assert.ok(h.textOf('toast-text').indexOf('PBI-002') !== -1);

  const before = h.calls.length;
  h.click('toast-undo');
  assert.equal(h.calls.length, before + 1);
  const restore = h.calls[before];
  assert.equal(restore.method, 'apiRestorePbi', 'apiCreatePbi では ID が変わってしまう');
  assert.equal(restore.args[0].id, 'PBI-002');
  assert.equal(restore.args[0].created_at, '2026-09-01', '作成日が失われている');
});

test('検証エラーではパネルが閉じず、入力が残る', () => {
  const h = ready();
  h.clickAdd('New');
  h.setValue('f-title', '');
  h.setValue('f-description', '書きかけの説明');
  h.click('panel-save');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: false, reason: 'invalid', message: 'タイトルを入力してください。', board: null });

  assert.equal(h.hiddenOf('panel'), false, 'パネルが閉じてしまった');
  assert.equal(h.valueOf('f-description'), '書きかけの説明', '入力が消えた');
  assert.ok(h.textOf('panel-message').indexOf('タイトル') !== -1);
});

test('送信中は保存と削除が押せない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  assert.equal(h.disabledOf('panel-save'), true, '二重送信できてしまう');
  assert.equal(h.disabledOf('panel-delete'), true);
});

test('列の追加ボタンは、その列のステータスを初期値にする', () => {
  const h = ready();
  h.clickAdd('Review');
  assert.equal(h.hiddenOf('panel'), false);
  assert.equal(h.valueOf('f-status'), 'Review', '列の文脈が初期値に入っていない');
});

test('パネルを開いてもドラッグできる（モードレス）', () => {
  // オーバーレイで盤面を覆わない。操作を制限しない。
  const h = ready();
  h.openCard('PBI-001');
  const before = h.calls.length;
  h.drag('PBI-002', 'Done');
  assert.equal(h.calls.length, before + 1, 'パネルを開くとドラッグできなくなっている');
});

// ---------------------------------------------------------------------------
// [hidden] が CSS に負けていないことの静的検査
// ---------------------------------------------------------------------------

test('hidden 属性が CSS で打ち消されていない', () => {
  // #panel や #toast に display:flex を当てると、UA スタイルの
  // [hidden]{display:none} が負けてパネルと通知が閉じなくなる。
  // シムは CSS を評価しないため、この欠陥は静的にしか検出できない。
  const targeted = styleRules().filter(function (r) {
    return selectorList(r.selector).indexOf('[hidden]') !== -1;
  });
  assert.ok(targeted.length > 0,
    '<style> の最上位に [hidden] を対象にした規則がありません');

  const enforced = targeted.some(function (r) {
    return declarations(r.body).some(function (d) {
      // !important が無いと #panel { display: flex } に負ける。
      return d.property === 'display' && /^none\s*!important$/i.test(d.value);
    });
  });
  assert.ok(enforced,
    '[hidden] の display が none !important になっていません（作成者オリジンの display 指定に負けます）');
});

// ---------------------------------------------------------------------------
// inflight の減算漏れが無いこと
// ---------------------------------------------------------------------------

const REMOVED = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };

/** 各系統を「呼び出しが1件だけ未応答」の状態まで進める。 */
const FLOWS = {
  'ドラッグ': (h) => { h.drag('PBI-001', 'Ready'); },
  '編集': (h) => { h.openCard('PBI-001'); h.setValue('f-title', 'A かいへん'); h.click('panel-save'); },
  '作成': (h) => { h.clickAdd('Done'); h.setValue('f-title', 'あたらしい'); h.click('panel-save'); },
  '削除': (h) => { h.openCard('PBI-002'); h.click('panel-delete'); },
  '取り消し': (h) => {
    h.openCard('PBI-002');
    h.click('panel-delete');
    h.calls[h.calls.length - 1].handlers.success(
      { ok: true, removed: REMOVED, board: h.boardOf(INITIAL) });
    h.click('toast-undo');
  },
};

/** 応答の返り方。成功・失敗（競合／検証エラー）・通信失敗の3通り。 */
const OUTCOMES = {
  '成功': (h, call) => call.handlers.success(
    { ok: true, id: 'PBI-003', removed: REMOVED, board: h.boardOf(INITIAL) }),
  '失敗応答': (h, call) => call.handlers.success(
    { ok: false, reason: 'conflict', message: 'ほかで更新されています。', board: h.boardOf(INITIAL) }),
  '検証エラー': (h, call) => call.handlers.success(
    { ok: false, reason: 'invalid', message: 'タイトルを入力してください。', board: null }),
  '通信失敗': (h, call) => call.handlers.failure({ message: '通信エラー' }),
};

// inflight が1件でも減り損なうと overlapped が永久に解除されず、以降ずっと
// board 全体を信じなくなる（＝画面とサーバが食い違う状態に戻る）。
Object.keys(FLOWS).forEach(function (flow) {
  Object.keys(OUTCOMES).forEach(function (outcome) {
    test('送信中の会計が戻る: ' + flow + ' / ' + outcome, () => {
      const h = ready();
      FLOWS[flow](h);
      assert.equal(h.calls.length, 1, flow + ' が1件の呼び出しになっていない');
      OUTCOMES[outcome](h, h.calls[0]);

      assert.equal(h.sandbox.inflight, 0, 'inflight が 0 に戻っていない');
      assert.equal(h.sandbox.overlapped, false, 'overlapped が解除されていない');
      assert.deepEqual(Object.keys(h.sandbox.pendingIds), [], 'pendingIds が残っている');
    });
  });
});

test('重なった送信でも、最後の応答で会計が戻る', () => {
  // 応答時にフラグを読むため、最後の応答の時点では他の pending は既に消えている。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.drag('PBI-002', 'Done');
  assert.equal(h.sandbox.inflight, 2);
  assert.equal(h.sandbox.overlapped, true, '重なりが記録されていない');

  const calls = h.calls.slice();
  calls[1].handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  assert.equal(h.sandbox.overlapped, true, 'まだ送信中があるのに解除された');
  calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL) });

  assert.equal(h.sandbox.inflight, 0);
  assert.equal(h.sandbox.overlapped, false, '次の batch まで重なりが残っている');
});

// ---------------------------------------------------------------------------
// 別パネルへの誤爆（panelSeq）
// ---------------------------------------------------------------------------

test('送信中に別のカードを開いていると、前の応答でそのパネルが閉じない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  const save = h.calls[h.calls.length - 1];

  h.openCard('PBI-002');                 // 応答を待つ間に別のパネルへ切り替える
  h.setValue('f-title', '書きかけ');
  save.handlers.success({ ok: true, board: h.boardOf(INITIAL) });

  assert.equal(h.hiddenOf('panel'), false, '別のカードのパネルが閉じられた');
  assert.equal(h.valueOf('f-title'), '書きかけ', '別のカードの入力が消えた');
});

test('作成の送信中に別の列の追加を押すと、前の応答でそのパネルが閉じない', () => {
  // どちらも panelState.id は null。通し番号（panelSeq）でしか区別できない。
  const h = ready();
  h.clickAdd('New');
  h.setValue('f-title', 'ひとつめ');
  h.click('panel-save');
  const create = h.calls[h.calls.length - 1];

  h.clickAdd('Done');
  h.setValue('f-title', 'ふたつめ');
  create.handlers.success({ ok: true, id: 'PBI-003', board: h.boardOf(INITIAL) });

  assert.equal(h.hiddenOf('panel'), false, '別の作成パネルが閉じられた');
  assert.equal(h.valueOf('f-title'), 'ふたつめ', '別の作成パネルの入力が消えた');
  assert.equal(h.valueOf('f-status'), 'Done', '別の作成パネルの列の文脈が失われた');
});

// ---------------------------------------------------------------------------
// 組み合わせ検査: 3操作 × commit順6 × 到達順6
// ---------------------------------------------------------------------------

const INITIAL3 = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' },
                           { id: 'PBI-003', title: 'C', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const OPS = [
  { kind: 'move', id: 'PBI-001', to: 'Ready' },
  { kind: 'move', id: 'PBI-002', to: 'In Progress' },
  { kind: 'edit', id: 'PBI-003', title: 'C かいへん' },
];
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

const copyCols = (cols) => cols.map(c => ({
  status: c.status, cards: c.cards.map(card => Object.assign({}, card))
}));

/** サーバ側の board に op を1件適用した新しい board を返す。 */
function applyOp(cols, op, stamp) {
  const next = copyCols(cols);
  let card = null;
  next.forEach(function (c) {
    c.cards.forEach(function (x) { if (x.id === op.id) card = x; });
  });
  if (!card) throw new Error('サーバ側に ' + op.id + ' が居ません');
  card.updated_at = stamp;
  if (op.kind === 'edit') { card.title = op.title; return next; }
  next.forEach(function (c) {
    c.cards = c.cards.filter(function (x) { return x.id !== op.id; });
  });
  const to = next.filter(function (c) { return c.status === op.to; })[0];
  to.cards.push(card);
  return next;
}

test('3操作を commit順6 × 到達順6 で回しても、画面がサーバと一致する', () => {
  PERMS.forEach(function (commit) {
    PERMS.forEach(function (deliver) {
      const label = 'commit=[' + commit + '] deliver=[' + deliver + ']';
      const h = createHarness(INITIAL3);
      h.sandbox.load();
      h.calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL3) });
      h.calls.length = 0;

      // 3操作を重ねて送る（どれも応答待ちのまま置く）
      h.drag('PBI-001', 'Ready');
      h.drag('PBI-002', 'In Progress');
      h.openCard('PBI-003');
      h.setValue('f-title', 'C かいへん');
      h.click('panel-save');
      assert.equal(h.calls.length, 3, label + ': 3件が送信されていない');
      const calls = h.calls.slice();

      // サーバは commit の順に処理する。応答が運ぶ board はその時点のもの。
      let server = copyCols(INITIAL3);
      const snapshots = [];
      commit.forEach(function (i, n) {
        server = applyOp(server, OPS[i], 'T' + (n + 2));
        snapshots[i] = copyCols(server);
      });
      // ブラウザへは deliver の順に届く。
      deliver.forEach(function (i) {
        calls[i].handlers.success({ ok: true, board: h.boardOf(snapshots[i]) });
      });

      assert.equal(fmt(h.screen()), fmt(h.columnsOf(server)), label + ': 画面がサーバと食い違った');
      assert.equal(h.sandbox.inflight, 0, label + ': inflight が戻っていない');
      assert.equal(h.sandbox.overlapped, false, label + ': overlapped が解除されていない');

      // 位置だけでなく、編集した内容が残っていることも確かめる。
      h.openCard('PBI-003');
      assert.equal(h.valueOf('f-title'), 'C かいへん', label + ': 編集の内容が消えた');
    });
  });
});

// ---------------------------------------------------------------------------
// 失敗応答・取り消しの経路でも、送信中の別カードの移動を巻き戻さない
// ---------------------------------------------------------------------------

const CARD_A = { id: 'PBI-001', title: 'A', updated_at: 'T1' };
const CARD_B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };

/** 5列のうち指定した列だけにカードを置いた [{status, cards}] を作る。 */
function cols(placed) {
  return ['New', 'Ready', 'In Progress', 'Review', 'Done'].map(function (s) {
    return { status: s, cards: placed[s] || [] };
  });
}

test('編集の競合応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.openCard('PBI-002');
  h.setValue('f-title', 'B かいへん');
  h.click('panel-save');

  // 競合。サーバが返す最新の board に PBI-001 の移動は入っていない。
  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'conflict', message: 'ほかで更新されています。',
    board: h.boardOf(cols({ New: [CARD_A, { id: 'PBI-002', title: 'B（サーバ側）', updated_at: 'T2' }] }))
  });

  assert.ok(h.screen()[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
});

test('削除の競合応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'conflict', message: 'ほかで更新されています。',
    board: h.boardOf(cols({ New: [CARD_A, CARD_B] }))
  });

  const screen = h.screen();
  assert.ok(screen[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(screen[0].cards.indexOf('PBI-002') !== -1, '消せなかったカードが戻っていない');
});

test('取り消しの応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.openCard('PBI-002');
  h.click('panel-delete');

  const removed = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, removed: removed, board: h.boardOf(cols({ New: [CARD_A] }))
  });

  h.click('toast-undo');
  const restore = h.calls[h.calls.length - 1];
  assert.equal(restore.method, 'apiRestorePbi');
  restore.handlers.success({ ok: true, board: h.boardOf(cols({ New: [CARD_A, CARD_B] })) });

  const screen = h.screen();
  assert.ok(screen[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(screen[0].cards.indexOf('PBI-002') !== -1, '戻したカードが出ていない');
});

test('取り消しの失敗応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  const removed = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, removed: removed, board: h.boardOf(cols({ New: [CARD_A] }))
  });

  h.click('toast-undo');
  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'duplicate', message: 'その ID は既にあります。',
    board: h.boardOf(cols({ New: [CARD_A, CARD_B] }))
  });

  assert.ok(h.screen()[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
});

test('送信中に別のパネルを開いていると、編集の失敗がそのパネルに出ない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  const save = h.calls[h.calls.length - 1];

  h.openCard('PBI-002');
  save.handlers.failure({ message: '通信エラー' });

  assert.equal(h.textOf('panel-message'), '', '別のカードのパネルに前の失敗が出た');
  assert.ok(h.textOf('message').indexOf('PBI-001') !== -1, '全体メッセージにも出ていない（黙って消えた）');
});

test('送信中に別のカードを開いていると、削除の応答でそのパネルが閉じない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-delete');
  const del = h.calls[h.calls.length - 1];

  h.openCard('PBI-002');
  h.setValue('f-title', '書きかけ');
  del.handlers.success({
    ok: true, removed: { id: 'PBI-001', title: 'A', created_at: '2026-09-01', updated_at: 'T1' },
    board: h.boardOf(cols({ New: [CARD_B] }))
  });

  assert.equal(h.hiddenOf('panel'), false, '別のカードのパネルが閉じられた');
  assert.equal(h.valueOf('f-title'), '書きかけ', '別のカードの入力が消えた');
});

test('送信中に別のパネルを開いていると、削除の失敗がそのパネルに出ない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-delete');
  const del = h.calls[h.calls.length - 1];

  h.openCard('PBI-002');
  del.handlers.failure({ message: '通信エラー' });

  assert.equal(h.textOf('panel-message'), '', '別のカードのパネルに前の失敗が出た');
  assert.ok(h.textOf('message').indexOf('PBI-001') !== -1, '全体メッセージにも出ていない（黙って消えた）');
});

test('読み込み直後はパネルも通知も出ていない', () => {
  // hidden 属性そのものが外れると、読み込んだ瞬間から出たままになる。
  const h = ready();
  assert.equal(h.hiddenOf('panel'), true, 'パネルが最初から出ている');
  assert.equal(h.hiddenOf('toast'), true, '通知が最初から出ている');
});

test('パネルを閉じたあとに届いた失敗は、全体メッセージで知らせる', () => {
  // 閉じたパネルに書いても本人には届かない。黙って消えるのが最悪。
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  const save = h.calls[h.calls.length - 1];

  h.click('panel-close');
  save.handlers.success(
    { ok: false, reason: 'invalid', message: 'タイトルを入力してください。', board: null });

  assert.equal(h.hiddenOf('panel'), true, '閉じたパネルが開き直された');
  assert.ok(h.textOf('message').indexOf('タイトル') !== -1, '閉じたあとの失敗が黙って消えた');
});
