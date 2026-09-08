const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, styleRules, selectorList, declarations } = require('./kanban_harness.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

/** 5列のうち指定した列だけにカードを置いた [{status, cards}] を作る。 */
function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', updated_at: 'T1' };
const CARD_B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };
const INITIAL = cols({ New: [CARD_A, CARD_B] });

const fmt = (c) => c.map(x => x.status + ':' + x.cards.join(',')).join(' | ');

// vm の中で作られたオブジェクトは prototype が別レルムのものになり、
// deepEqual（strict）が prototype の違いで落ちる。素の object に写してから比べる。
const plain = (o) => Object.assign({}, o);

// web_app.js の定型文（conflictMessage_ / withBacklogWrite_）に合わせる。
const CONFLICT_MSG = '他の変更が先に入っています。最新の内容に更新しました。';
const BUSY_MSG = '他の更新が実行中です。少し待って再試行してください。';

/** 初期読み込みを済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL) });
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
  save.handlers.success({ ok: true, id: null, removed: null, board: h.boardOf(cols({
    New: [CARD_A, { id: 'PBI-002', title: 'B かいへん', updated_at: 'T2' }]
  })) });

  const screen = h.screen();
  assert.equal(screen[1].cards.indexOf('PBI-001') !== -1, true,
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

  create.handlers.success({ ok: true, id: 'PBI-003', removed: null, board: h.boardOf(cols({
    New: [CARD_A, CARD_B],
    Done: [{ id: 'PBI-003', title: 'あたらしい', updated_at: 'T2' }]
  })) });

  const screen = h.screen();
  assert.ok(screen[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(screen[4].cards.indexOf('PBI-003') !== -1, '作った PBI が出ていない');
});

test('削除の応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  const del = h.calls[h.calls.length - 1];
  assert.equal(del.method, 'apiDeletePbi');

  del.handlers.success({ ok: true, id: null, removed: { id: 'PBI-002', title: 'B' },
    board: h.boardOf(cols({ New: [CARD_A] })) });

  const screen = h.screen();
  assert.ok(screen[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.equal(screen[0].cards.indexOf('PBI-002'), -1, '消したカードが残っている');
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
  h.calls[h.calls.length - 1].handlers.success({ ok: true, id: null, removed: removed,
    board: h.boardOf(cols({ New: [CARD_A] })) });

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
  // invalid は withBacklogWrite_ が board を明示しないため、実サーバでは board が付く。
  h.calls[h.calls.length - 1].handlers.success({ ok: false, reason: 'invalid',
    message: 'タイトルを入力してください。', board: h.boardOf(INITIAL) });

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
  assert.ok(targeted.length > 0, '<style> の最上位に [hidden] を対象にした規則がありません');

  const enforced = targeted.some(function (r) {
    return declarations(r.body).some(function (d) {
      // !important が無いと #panel { display: flex } に負ける。
      return d.property === 'display' && /^none\s*!important$/i.test(d.value);
    });
  });
  assert.ok(enforced,
    '[hidden] の display が none !important になっていません（作成者オリジンの display 指定に負けます）');
});

test('読み込み直後はパネルも通知も出ていない', () => {
  // hidden 属性そのものが外れると、読み込んだ瞬間から出たままになる。
  const h = ready();
  assert.equal(h.hiddenOf('panel'), true, 'パネルが最初から出ている');
  assert.equal(h.hiddenOf('toast'), true, '通知が最初から出ている');
});

// ---------------------------------------------------------------------------
// サーバへ送る引数
// ---------------------------------------------------------------------------

const FULL_CARD = {
  id: 'PBI-009', title: 'ぜんぶ', description: 'せつめい', acceptance_criteria: 'あ; い',
  priority: 'High', size: '3', sprint: 'sprint001', updated_at: 'T1'
};

test('カードを開くと、その内容が入力欄に入る', () => {
  const initial = cols({ Review: [FULL_CARD] });
  const h = createHarness(initial);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.boardOf(initial) });

  h.openCard('PBI-009');
  assert.equal(h.valueOf('f-title'), 'ぜんぶ');
  assert.equal(h.valueOf('f-description'), 'せつめい');
  assert.equal(h.valueOf('f-acceptance'), 'あ; い');
  assert.equal(h.valueOf('f-status'), 'Review', '今いる列がステータスに入っていない');
  assert.equal(h.valueOf('f-priority'), 'High');
  assert.equal(h.valueOf('f-size'), '3');
  assert.equal(h.valueOf('f-sprint'), 'sprint001');
});

test('編集は入力欄の内容と updated_at をそのままサーバへ送る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.setValue('f-title', 'A かいへん');
  h.setValue('f-description', 'せつめい');
  h.setValue('f-acceptance', 'あ; い');
  h.setValue('f-status', 'Review');
  h.setValue('f-priority', 'High');
  h.setValue('f-size', '3');
  h.setValue('f-sprint', 'sprint001');
  h.click('panel-save');

  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdatePbi');
  assert.equal(call.args[0], 'PBI-001');
  assert.deepEqual(plain(call.args[1]), {
    title: 'A かいへん', description: 'せつめい', acceptance_criteria: 'あ; い',
    status: 'Review', priority: 'High', size: '3', sprint: 'sprint001'
  }, '入力欄の内容がそのまま送られていない');
  // これが欠けるとサーバ側の競合検出（applyRowUpdate）が素通りする。
  assert.equal(call.args[2], 'T1', '競合検出のための updated_at が送られていない');
});

test('作成は入力欄の内容をそのままサーバへ送る', () => {
  const h = ready();
  h.clickAdd('Ready');
  h.setValue('f-title', 'あたらしい');
  h.setValue('f-description', 'せつめい');
  h.setValue('f-acceptance', 'あ; い');
  h.setValue('f-priority', 'Low');
  h.setValue('f-size', '5');
  h.setValue('f-sprint', 'sprint002');
  h.click('panel-save');

  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiCreatePbi');
  assert.equal(call.args.length, 1, '作成は fields ひとつだけを送る');
  assert.deepEqual(plain(call.args[0]), {
    title: 'あたらしい', description: 'せつめい', acceptance_criteria: 'あ; い',
    status: 'Ready', priority: 'Low', size: '5', sprint: 'sprint002'
  }, '入力欄の内容がそのまま送られていない');
});

test('ドラッグは移した先のステータスと updated_at をサーバへ送る', () => {
  const h = ready();
  h.drag('PBI-001', 'Review');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdateStatus');
  assert.equal(call.args[0], 'PBI-001');
  assert.equal(call.args[1], 'Review', '画面と違うステータスをサーバへ送っている');
  assert.equal(call.args[2], 'T1', '競合検出のための updated_at が送られていない');
});

test('削除は updated_at をサーバへ送る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-delete');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiDeletePbi');
  assert.equal(call.args[0], 'PBI-001');
  assert.equal(call.args[1], 'T1', '競合検出のための updated_at が送られていない');
});

// ---------------------------------------------------------------------------
// 失敗応答・取り消しの経路でも、送信中の別カードの移動を巻き戻さない
// ---------------------------------------------------------------------------

test('編集の競合応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.openCard('PBI-002');
  h.setValue('f-title', 'B かいへん');
  h.click('panel-save');

  // 競合。サーバが返す最新の board に PBI-001 の移動は入っていない。
  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'conflict', message: CONFLICT_MSG,
    board: h.boardOf(cols({ New: [CARD_A, { id: 'PBI-002', title: 'B（サーバ側）', updated_at: 'T2' }] }))
  });

  assert.ok(h.screen()[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
});

test('作成の検証エラーが、送信中の別カードの移動を巻き戻さない', () => {
  // invalid でも実サーバは board を返す（withBacklogWrite_ が buildBoardData を載せる）。
  // 作成はまだ id が無く1枚だけ取り込めないので、重なっている間は board に触らない。
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.clickAdd('Done');
  h.setValue('f-title', '');
  h.click('panel-save');

  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'invalid', message: 'タイトルを入力してください。',
    board: h.boardOf(INITIAL)          // PBI-001 の移動は入っていない
  });

  assert.ok(h.screen()[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.equal(h.hiddenOf('panel'), false, 'パネルが閉じてしまった');
});

test('削除の競合応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'conflict', message: CONFLICT_MSG, board: h.boardOf(INITIAL)
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
    ok: true, id: null, removed: removed, board: h.boardOf(cols({ New: [CARD_A] }))
  });

  h.click('toast-undo');
  const restore = h.calls[h.calls.length - 1];
  assert.equal(restore.method, 'apiRestorePbi');
  restore.handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ New: [CARD_A, CARD_B] })) });

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
    ok: true, id: null, removed: removed, board: h.boardOf(cols({ New: [CARD_A] }))
  });

  h.click('toast-undo');
  h.calls[h.calls.length - 1].handlers.success({
    ok: false, reason: 'duplicate_id', message: 'この PBI は既に存在します。取り消しは要りません。',
    board: h.boardOf(cols({ New: [CARD_A, CARD_B] }))
  });

  assert.ok(h.screen()[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
});

test('取り消し自身が重なりの起点になる（削除の応答で一度解除されたあと）', () => {
  // 削除 → 応答（ここで重なりが解ける）→ ドラッグ → 取り消し、の順。
  // restorePbi が自分で重なりを記録しないと、この応答が board 全体を信じてしまう。
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  const removed = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, id: null, removed: removed, board: h.boardOf(cols({ New: [CARD_A] }))
  });
  assert.equal(h.sandbox.inflight, 0, '重なりが解けた状態から始めたい');
  assert.equal(h.sandbox.overlapped, false);

  h.drag('PBI-001', 'Ready');           // 送信中のまま置く
  h.click('toast-undo');                // ここで初めて重なる
  const restore = h.calls[h.calls.length - 1];
  assert.equal(restore.method, 'apiRestorePbi');
  restore.handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ New: [CARD_A, CARD_B] })) });   // 移動は入っていない

  const screen = h.screen();
  assert.ok(screen[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(screen[0].cards.indexOf('PBI-002') !== -1, '戻したカードが出ていない');
});

// ---------------------------------------------------------------------------
// inflight の会計
// ---------------------------------------------------------------------------

const REMOVED = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };

// 応答の形は web_app.js の withBacklogWrite_ に合わせる。
// ok:true は必ず id / removed を持つ（使わない系統では null）。
// board が null になるのは bad_status / busy / catch のときだけで、
// invalid や conflict では board が付く。
const FLOWS = {
  'ドラッグ': {
    method: 'apiUpdateStatus',
    send: (h) => { h.drag('PBI-001', 'Ready'); },
    outcomes: {
      '成功': (h) => ({ ok: true, id: null, removed: null,
        board: h.boardOf(cols({ New: [CARD_B], Ready: [CARD_A] })) }),
      '競合': (h) => ({ ok: false, reason: 'conflict', message: CONFLICT_MSG, board: h.boardOf(INITIAL) }),
      '不明なステータス': () => ({ ok: false, reason: 'bad_status', message: '不明なステータスです: X', board: null }),
      '実行中': () => ({ ok: false, reason: 'busy', message: BUSY_MSG, board: null }),
    }
  },
  '編集': {
    method: 'apiUpdatePbi',
    send: (h) => { h.openCard('PBI-001'); h.setValue('f-title', 'A かいへん'); h.click('panel-save'); },
    outcomes: {
      '成功': (h) => ({ ok: true, id: null, removed: null,
        board: h.boardOf(cols({ New: [{ id: 'PBI-001', title: 'A かいへん', updated_at: 'T2' }, CARD_B] })) }),
      '検証エラー': (h) => ({ ok: false, reason: 'invalid', message: 'タイトルを入力してください。',
        board: h.boardOf(INITIAL) }),
      '競合': (h) => ({ ok: false, reason: 'conflict', message: CONFLICT_MSG, board: h.boardOf(INITIAL) }),
      '実行中': () => ({ ok: false, reason: 'busy', message: BUSY_MSG, board: null }),
    }
  },
  '作成': {
    method: 'apiCreatePbi',
    send: (h) => { h.clickAdd('Done'); h.setValue('f-title', 'あたらしい'); h.click('panel-save'); },
    outcomes: {
      '成功': (h) => ({ ok: true, id: 'PBI-003', removed: null,
        board: h.boardOf(cols({ New: [CARD_A, CARD_B],
          Done: [{ id: 'PBI-003', title: 'あたらしい', updated_at: 'T2' }] })) }),
      '検証エラー': (h) => ({ ok: false, reason: 'invalid', message: 'タイトルを入力してください。',
        board: h.boardOf(INITIAL) }),
      'ID 重複': (h) => ({ ok: false, reason: 'duplicate_id', message: 'ID が重複しました。もう一度お試しください。',
        board: h.boardOf(INITIAL) }),
      '実行中': () => ({ ok: false, reason: 'busy', message: BUSY_MSG, board: null }),
    }
  },
  '削除': {
    method: 'apiDeletePbi',
    send: (h) => { h.openCard('PBI-002'); h.click('panel-delete'); },
    outcomes: {
      '成功': (h) => ({ ok: true, id: null, removed: REMOVED, board: h.boardOf(cols({ New: [CARD_A] })) }),
      '競合': (h) => ({ ok: false, reason: 'conflict', message: CONFLICT_MSG, board: h.boardOf(INITIAL) }),
      '不在': (h) => ({ ok: false, reason: 'not_found', message: 'この PBI が見つかりません。最新の内容に更新しました。',
        board: h.boardOf(cols({ New: [CARD_A] })) }),
      '実行中': () => ({ ok: false, reason: 'busy', message: BUSY_MSG, board: null }),
    }
  },
  '取り消し': {
    method: 'apiRestorePbi',
    send: (h) => {
      h.openCard('PBI-002');
      h.click('panel-delete');
      h.calls[h.calls.length - 1].handlers.success(
        { ok: true, id: null, removed: REMOVED, board: h.boardOf(cols({ New: [CARD_A] })) });
      h.click('toast-undo');
    },
    outcomes: {
      '成功': (h) => ({ ok: true, id: null, removed: null, board: h.boardOf(INITIAL) }),
      '既に存在': (h) => ({ ok: false, reason: 'duplicate_id',
        message: 'この PBI は既に存在します。取り消しは要りません。', board: h.boardOf(INITIAL) }),
      '実行中': () => ({ ok: false, reason: 'busy', message: BUSY_MSG, board: null }),
    }
  },
};

// inflight が1件でも減り損なうと overlapped が永久に解除されず、以降ずっと
// board 全体を信じなくなる（＝画面とサーバが食い違う状態に戻る）。
Object.keys(FLOWS).forEach(function (name) {
  const flow = FLOWS[name];
  Object.keys(flow.outcomes).forEach(function (outcome) {
    test('送信中の会計が戻る: ' + name + ' / ' + outcome, () => {
      const h = ready();
      flow.send(h);
      assert.equal(h.calls.length, 1, name + ' が1件の呼び出しになっていない');
      assert.equal(h.calls[0].method, flow.method);
      h.calls[0].handlers.success(flow.outcomes[outcome](h));

      assert.equal(h.sandbox.inflight, 0, 'inflight が 0 に戻っていない');
      assert.equal(h.sandbox.overlapped, false, 'overlapped が解除されていない');
      assert.deepEqual(Object.keys(h.sandbox.pendingIds), [], 'pendingIds が残っている');
    });
  });

  test('送信中の会計が戻る: ' + name + ' / 通信失敗', () => {
    const h = ready();
    flow.send(h);
    assert.equal(h.calls.length, 1);
    h.calls[0].handlers.failure({ message: '通信エラー' });

    assert.equal(h.sandbox.inflight, 0, 'inflight が 0 に戻っていない');
    assert.equal(h.sandbox.overlapped, false, 'overlapped が解除されていない');
    assert.deepEqual(Object.keys(h.sandbox.pendingIds), [], 'pendingIds が残っている');
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
  calls[1].handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ New: [CARD_A], Done: [CARD_B] })) });
  assert.equal(h.sandbox.overlapped, true, 'まだ送信中があるのに解除された');
  calls[0].handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ Ready: [CARD_A], New: [CARD_B] })) });

  assert.equal(h.sandbox.inflight, 0);
  assert.equal(h.sandbox.overlapped, false, '次の batch まで重なりが残っている');
});

test('重なりが解けたあとの単独の応答は、board 全体を取り込む', () => {
  // 会計が漏れて overlapped が解除されないと、以降の応答は1枚しか取り込まなくなり、
  // 外（ローカルの Claude Code 等）で増減したカードが画面に出なくなる。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.drag('PBI-002', 'Done');
  const overlapping = h.calls.slice();
  overlapping[0].handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ Ready: [CARD_A], New: [CARD_B] })) });
  overlapping[1].handlers.success({ ok: true, id: null, removed: null,
    board: h.boardOf(cols({ Ready: [CARD_A], Done: [CARD_B] })) });

  // ここからは重なっていない。次の応答は board 全体を信じてよい。
  h.drag('PBI-001', 'Review');
  h.calls[0].handlers.success({ ok: true, id: null, removed: null, board: h.boardOf(cols({
    New: [{ id: 'PBI-900', title: '外で増えた', updated_at: 'T9' }],
    Review: [CARD_A], Done: [CARD_B]
  })) });

  assert.ok(h.screen()[0].cards.indexOf('PBI-900') !== -1,
    '外で増えたカードが画面に出ない（重なりが解除されていない）');
});

test('送信中のカードは再ドラッグできない', () => {
  // dragstart 側と drop 側の二重防御。両方外れると二重送信になる。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  const before = h.calls.length;
  h.drag('PBI-001', 'Done');
  assert.equal(h.calls.length, before, '送信中のカードが二重に送信された');
});

test('送信中のカードはパネルを開けない', () => {
  // 送信中の内容を編集させると、応答が返った時点でどちらが新しいか決められない。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-001');
  assert.equal(h.hiddenOf('panel'), true, '送信中のカードのパネルが開けてしまう');
});

test('取り消しの送信中に最新にしても、戻ってきたカードは操作できる', () => {
  // pendingIds は「送信中の会計」と「実在カードの表示・操作抑止」を兼ねている。
  // 取り消しを素の id で載せると、load() で board へ戻ってきた同じ id のカードが
  // 送信中扱いになり、開くこともドラッグもできなくなる。load() は inflight にも
  // pendingIds にも触らないため、他の経路では気づけない。
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: true, id: null, removed: REMOVED, board: h.boardOf(cols({ New: [CARD_A] })) });

  h.click('toast-undo');                 // 取り消しは送信中のまま置く
  assert.equal(h.calls[h.calls.length - 1].method, 'apiRestorePbi');

  h.click('reload');                     // 応答を待つ間に「最新にする」を押す
  const reload = h.calls[h.calls.length - 1];
  assert.equal(reload.method, 'apiGetBoard');
  // サーバでは取り消しが既に反映済みで、PBI-002 が戻って届く。
  reload.handlers.success({ ok: true, board: h.boardOf(INITIAL) });

  h.openCard('PBI-002');
  assert.equal(h.hiddenOf('panel'), false, '戻ってきたカードが開けない（送信中扱いになっている）');
  const before = h.calls.length;
  h.drag('PBI-002', 'Ready');
  assert.equal(h.calls.length, before + 1, '戻ってきたカードをドラッグできない');
});

// ---------------------------------------------------------------------------
// 別パネルへの誤爆（panelSeq）
// ---------------------------------------------------------------------------

test('保存が成功するとパネルが閉じる', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  h.calls[0].handlers.success({ ok: true, id: null, removed: null, board: h.boardOf(INITIAL) });
  assert.equal(h.hiddenOf('panel'), true, '保存後もパネルが開いたまま');
  assert.ok(h.textOf('message').indexOf('PBI-001') !== -1, '保存したことが伝わらない');
});

test('削除が成功するとパネルが閉じる', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  h.calls[0].handlers.success({ ok: true, id: null, removed: REMOVED,
    board: h.boardOf(cols({ New: [CARD_A] })) });
  assert.equal(h.hiddenOf('panel'), true, '削除後もパネルが開いたまま');
});

test('送信中に別のカードを開いていると、前の応答でそのパネルが閉じない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  const save = h.calls[h.calls.length - 1];

  h.openCard('PBI-002');                 // 応答を待つ間に別のパネルへ切り替える
  h.setValue('f-title', '書きかけ');
  save.handlers.success({ ok: true, id: null, removed: null, board: h.boardOf(INITIAL) });

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
  create.handlers.success({ ok: true, id: 'PBI-003', removed: null, board: h.boardOf(INITIAL) });

  assert.equal(h.hiddenOf('panel'), false, '別の作成パネルが閉じられた');
  assert.equal(h.valueOf('f-title'), 'ふたつめ', '別の作成パネルの入力が消えた');
  assert.equal(h.valueOf('f-status'), 'Done', '別の作成パネルの列の文脈が失われた');
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
  del.handlers.success({ ok: true, id: null,
    removed: { id: 'PBI-001', title: 'A', created_at: '2026-09-01', updated_at: 'T1' },
    board: h.boardOf(cols({ New: [CARD_B] })) });

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

test('パネルを閉じたあとに届いた失敗は、全体メッセージで知らせる', () => {
  // 閉じたパネルに書いても本人には届かない。黙って消えるのが最悪。
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  const save = h.calls[h.calls.length - 1];

  h.click('panel-close');
  save.handlers.success({ ok: false, reason: 'invalid',
    message: 'タイトルを入力してください。', board: h.boardOf(INITIAL) });

  assert.equal(h.hiddenOf('panel'), true, '閉じたパネルが開き直された');
  assert.ok(h.textOf('message').indexOf('タイトル') !== -1, '閉じたあとの失敗が黙って消えた');
});

// ---------------------------------------------------------------------------
// 通知の寿命と Escape
// ---------------------------------------------------------------------------

/** PBI-002 を削除して取り消せる通知を出した状態にする。 */
function deleted() {
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: true, id: null, removed: REMOVED, board: h.boardOf(cols({ New: [CARD_A] })) });
  return h;
}

test('通知は時間が過ぎると自動で消える', () => {
  const h = deleted();
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.flushTimers(), 1, '通知の期限が仕掛けられていない');
  assert.equal(h.hiddenOf('toast'), true, '通知が出たままになる');
});

test('期限が過ぎた通知からは取り消せない', () => {
  // 隠すだけで onclick を外さないと、消えた通知のボタンが押せてしまう。
  const h = deleted();
  h.flushTimers();
  const before = h.calls.length;
  h.click('toast-undo');
  assert.equal(h.calls.length, before, '期限切れの通知から取り消せてしまう');
});

test('続けて削除すると、前の取り消しがもう押せないことを知らせる', () => {
  // 通知は1件しか出せない。黙って上書きすると前の取り消しを失う。
  const h = deleted();
  const firstText = h.textOf('toast-text');

  h.openCard('PBI-001');
  h.click('panel-delete');
  h.calls[h.calls.length - 1].handlers.success({ ok: true, id: null,
    removed: { id: 'PBI-001', title: 'A', created_at: '2026-09-01', updated_at: 'T1' },
    board: h.boardOf(cols({})) });

  assert.ok(h.textOf('toast-text').indexOf('PBI-001') !== -1, '新しい通知になっていない');
  assert.ok(h.textOf('message').indexOf(firstText) !== -1
    && h.textOf('message').indexOf('取り消せません') !== -1,
    '上書きされた通知のことが伝わらない');
});

test('Escape は通知を先に閉じ、通知が無ければパネルを閉じる', () => {
  const h = deleted();                   // 削除でパネルは閉じ、通知が出ている
  h.openCard('PBI-001');                 // 通知を出したままパネルを開く
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.hiddenOf('panel'), false);

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('toast'), true, 'Escape で通知が閉じない');
  assert.equal(h.hiddenOf('panel'), false, '通知とパネルが同時に閉じた');

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('panel'), true, '2度目の Escape でパネルが閉じない');
});

test('Escape 以外のキーでは何も閉じない', () => {
  const h = deleted();
  h.pressKey('Enter');
  assert.equal(h.hiddenOf('toast'), false, 'Enter で通知が閉じた');
});

// ---------------------------------------------------------------------------
// 組み合わせ検査: 3操作 × commit順6 × 到達順6
// ---------------------------------------------------------------------------

const INITIAL3 = cols({ New: [CARD_A, CARD_B, { id: 'PBI-003', title: 'C', updated_at: 'T1' }] });
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

const copyCols = (c) => c.map(x => ({ status: x.status, cards: x.cards.map(y => Object.assign({}, y)) }));

/**
 * サーバ側の board に「実際に送られてきた呼び出し」を1件適用する。
 * 引数から board を作るので、画面と違う値を送っていれば結果が食い違う。
 */
function applyCall(current, call, stamp) {
  const next = copyCols(current);
  const id = call.args[0];
  let card = null;
  next.forEach(function (c) { c.cards.forEach(function (x) { if (x.id === id) card = x; }); });
  assert.ok(card, 'サーバ側に ' + id + ' が居ません');
  // 実サーバ（applyRowUpdate）はここで競合を判定する。値が違えば拒否される。
  assert.equal(call.args[2], card.updated_at, id + ': 競合検出のための updated_at が違う');

  let to;
  if (call.method === 'apiUpdateStatus') {
    to = call.args[1];
  } else if (call.method === 'apiUpdatePbi') {
    const fields = call.args[1];
    card.title = fields.title;
    card.description = fields.description;
    to = fields.status;
  } else {
    throw new Error('この検査で想定していないメソッド: ' + call.method);
  }
  const target = next.filter(function (c) { return c.status === to; })[0];
  assert.ok(target, id + ': 不明なステータスを送っている: ' + to);

  card.updated_at = stamp;
  next.forEach(function (c) { c.cards = c.cards.filter(function (x) { return x.id !== id; }); });
  target.cards.push(card);
  return next;
}

test('3操作を commit順6 × 到達順6 で回しても、画面がサーバと一致する', () => {
  PERMS.forEach(function (commit) {
    PERMS.forEach(function (deliver) {
      const label = 'commit=[' + commit + '] deliver=[' + deliver + ']';
      const h = createHarness(INITIAL3);
      h.sandbox.load();
      h.calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL3) });

      // 3操作を重ねて送る（どれも応答待ちのまま置く）
      h.drag('PBI-001', 'Ready');
      h.drag('PBI-002', 'In Progress');
      h.openCard('PBI-003');
      h.setValue('f-title', 'C かいへん');
      h.setValue('f-description', 'せつめい');
      h.click('panel-save');
      assert.equal(h.calls.length, 3, label + ': 3件が送信されていない');
      const calls = h.calls.slice();

      // 画面でした操作が、そのままサーバへ送られているか。
      assert.equal(calls[0].method, 'apiUpdateStatus');
      assert.equal(calls[0].args[0], 'PBI-001');
      assert.equal(calls[0].args[1], 'Ready', label + ': 画面と違うステータスを送っている');
      assert.equal(calls[1].args[1], 'In Progress', label + ': 画面と違うステータスを送っている');
      assert.equal(calls[2].method, 'apiUpdatePbi');
      assert.equal(calls[2].args[0], 'PBI-003');
      assert.equal(calls[2].args[1].title, 'C かいへん');
      assert.equal(calls[2].args[1].description, 'せつめい');
      assert.equal(calls[2].args[1].status, 'New');

      // サーバは commit の順に、送られてきた引数どおりに処理する。
      // 応答が運ぶ board はその時点のもの。
      let server = copyCols(INITIAL3);
      const snapshots = [];
      commit.forEach(function (i, n) {
        server = applyCall(server, calls[i], 'T' + (n + 2));
        snapshots[i] = copyCols(server);
      });
      // ブラウザへは deliver の順に届く。
      deliver.forEach(function (i) {
        calls[i].handlers.success({ ok: true, id: null, removed: null, board: h.boardOf(snapshots[i]) });
      });

      assert.equal(fmt(h.screen()), fmt(h.columnsOf(server)), label + ': 画面がサーバと食い違った');
      assert.equal(h.sandbox.inflight, 0, label + ': inflight が戻っていない');
      assert.equal(h.sandbox.overlapped, false, label + ': overlapped が解除されていない');

      // 位置だけでなく、編集した内容が残っていることも確かめる。
      h.openCard('PBI-003');
      assert.equal(h.valueOf('f-title'), 'C かいへん', label + ': 編集の内容が消えた');
      assert.equal(h.valueOf('f-description'), 'せつめい', label + ': 編集の内容が消えた');
    });
  });
});
