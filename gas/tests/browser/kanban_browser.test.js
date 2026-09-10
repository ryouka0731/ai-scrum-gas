'use strict';
/**
 * 実ブラウザ（Chrome の headless）で kanban.html を開いて確かめる。
 *
 * ## なぜ本体のスイートと分けてあるか
 *
 * gas/tests/kanban_harness.js の DOM シムは **CSS を評価しない**。この画面は
 * そのせいで実際に痛い目に遭っている:
 * - `[hidden]` が `display: flex` に負けて「パネルと通知が読み込み直後から出たまま
 *   閉じない」不具合を、**シムでのレビュー5回が見逃した**。
 * - 表ヘッダーの補足が `#table-view` の `overflow` に切り取られていた件
 *   （`受入基準` が 17px 欠け、本文は 187px 溢れた）と、375px で表が枠の中で
 *   スクロールせずページごと横に伸びていた件も、**シムでは原理的に見えない**。
 *
 * ここはその穴だけを埋める。振る舞いの検査は本体のスイートに置く。
 *
 * ## Chrome が無い環境
 *
 * **飛ばす**（失敗にしない）。本体のスイート（`npm test`）はこのディレクトリを
 * 走らせないので、Chrome に依存しない。ここだけを走らせるのは `npm run test:browser`。
 *
 * ## 「黙って別のものを測る」ことへの備え
 *
 * 測定は前提を実測して突き合わせる（chrome_session.js のコメントを参照）。
 * 幅・配色・どのページを見ているかが食い違えば、成功ではなく**失敗**になる。
 * 加えて、この検査では「対象が0件でも通ってしまう」形の空振りを潰すため、
 * 測れた件数そのものも固定している。
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { chromePath, launch } = require('./chrome_session.js');
const { buildStandalonePage, viewportContentFromDoGet } = require('./standalone_page.js');
const { measureOne, WIDTHS, SCHEMES, HEIGHT, TABLE_VIEW_LABEL } = require('./measure.js');

/** 見本のデータから決まる、必ず出るはずの補足の件数。0件で空振りしないための錘。 */
const EXPECTED_BOARD_HELPS = 10;   // 列見出し5 + カードの優先度5
const EXPECTED_TABLE_HELPS = 3;    // 一覧の列見出しのうち用語集にあるもの（ポイント/スプリント/受入基準）

const CHROME = chromePath();
const SKIP = CHROME ? false : 'Chrome が見つからないので飛ばします（CHROME_PATH で指定できます）';

/** 補足1件の判定。落ちたときにどの条件のどの用語かが分かる文面にする。 */
function assertHelpIsReadable(h, where) {
  const at = where + ' の ' + h.host + ' 「' + h.term + '」の補足';
  assert.equal(h.attached, true, at + ': 測っている間に DOM から外れた');
  assert.equal(h.opened, true, at + ': 開かなかった（display が none のまま）');
  assert.equal(h.expanded, 'true', at + ': aria-expanded が true になっていない');
  assert.equal(h.visibleRatio, 1, at + ': 可視率が ' + h.visibleRatio
    + '（祖先の overflow に切り取られたか、画面の外に出ている）: ' + JSON.stringify(h.rect));
  assert.equal(h.insideViewport, true, at + ': 画面の外にはみ出している: ' + JSON.stringify(h.rect));
  assert.ok(h.scrollWidth <= h.clientWidth, at + ': 本文が枠から溢れている（scrollWidth '
    + h.scrollWidth + ' > clientWidth ' + h.clientWidth + '）');
}

/** 通知は狭い画面では上端、広い画面では下端に出る（`@media (max-width: 900px)` の境目）。 */
const NARROW_MAX = 900;

/** 補足を押した結果1件の判定。押した先が違っても、振る舞いは同じでなければならない。 */
function assertPressOpensOnlyTheHelp(r, where) {
  const at = where + ' の ' + r.where + ' の ?';
  assert.equal(r.before.panelHidden, true, at + ': 押す前からパネルが開いている（前提が崩れた）');
  assert.equal(r.before.bodyHidden, true, at + ': 押す前から補足が開いている（前提が崩れた）');
  assert.equal(r.first.stillAttached, true,
    at + ': 押したら補足が DOM から消えた（周りが描き直された）');
  assert.equal(r.first.opened, true, at + ': 押しても補足が開かない');
  assert.equal(r.first.expanded, 'true', at + ': aria-expanded が開いた状態になっていない');
  assert.equal(r.first.visibleRatio, 1, at + ': 開いた補足が見えていない');
  // 押したのは補足。周りは動いてはいけない。
  assert.equal(r.first.panelHidden, true,
    at + ': 押したら編集パネルまで開いた（click が親へ上がっている。開いたのは '
    + r.first.panelTitle + '）');
  if (r.first.cardSelected !== null) {
    assert.equal(r.first.cardSelected, false, at + ': 押したらそのカードが選択状態になった');
  }
  assert.ok(r.second, at + ': 2回目が測れていない（1回目で周りが描き直された）');
  assert.equal(r.second.opened, false, at + ': もう一度押しても閉じない');
  assert.equal(r.second.expanded, 'false', at + ': aria-expanded が閉じた状態になっていない');
  assert.equal(r.second.panelHidden, true, at + ': 2回目でパネルが開いた');
}

describe('実ブラウザでの検査', { skip: SKIP }, () => {
  /** @type {Record<string, object>} 条件ごとの測定結果。before で1回だけ集める。 */
  const measured = {};
  let session = null;
  let html = null;

  const keyOf = (width, scheme) => width + 'px / ' + scheme;

  before(async () => {
    html = buildStandalonePage();
    session = await launch();
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        measured[keyOf(width, scheme)] =
          await measureOne(session, html, { width: width, height: HEIGHT, scheme: scheme });
      }
    }
  });

  after(async () => { if (session) await session.close(); });

  SCHEMES.forEach(function (scheme) {
    WIDTHS.forEach(function (width) {
      const where = keyOf(width, scheme);

      describe(where, () => {
        test('指定した幅・配色・ページを実際に測れている', () => {
          const m = measured[where];
          assert.equal(m.actualViewport.clientWidth, width,
            where + ': 描かれた幅が指定と違う（viewport meta = ' + m.actualViewport.metaViewport + '）');
          assert.equal(m.actualViewport.dark, scheme === 'dark', where + ': 配色が指定と違う');
          assert.equal(m.actualViewport.metaViewport, viewportContentFromDoGet(),
            where + ': doGet が付ける viewport の meta と違うもので描かれている');
          assert.deepEqual(m.board.viewport.pageErrors, [], where + ': ページで JS 例外が出ている');
          assert.ok(m.board.viewport.calls.indexOf('apiGetView(board)') !== -1,
            where + ': 初回の読み込みが呼ばれていない: ' + JSON.stringify(m.board.viewport.calls));
        });

        test('#board の補足が切り取られず、溢れず、画面に収まる', () => {
          const m = measured[where];
          assert.equal(m.board.helps.length, EXPECTED_BOARD_HELPS,
            where + ': 盤面の補足が ' + m.board.helps.length + ' 件しか測れていない'
            + '（0件でも他の判定は通ってしまうため件数を固定している）');
          m.board.helps.forEach(function (h) { assertHelpIsReadable(h, where); });
        });

        test('#table-view の補足が切り取られず、溢れず、画面に収まる', () => {
          const m = measured[where];
          assert.equal(m.table.helps.length, EXPECTED_TABLE_HELPS,
            where + ': 表の補足が ' + m.table.helps.length + ' 件しか測れていない');
          m.table.helps.forEach(function (h) { assertHelpIsReadable(h, where); });
        });

        test('表は枠の中で横スクロールし、ページを横に伸ばさない', () => {
          // 盤面のほうも見る。長いタイトルや列の最小幅でカードがはみ出せば、
          // 表と同じようにページごと横に伸びる。
          const b = measured[where].board.overflow;
          assert.equal(b.board.hidden, false, where + ': 盤面が出ていない前提が崩れた');
          assert.ok(b.board.clientWidth <= b.rootClientWidth,
            where + ': #board の幅 ' + b.board.clientWidth
            + 'px が画面の幅 ' + b.rootClientWidth + 'px を超えた');
          assert.ok(b.bodyScrollWidth <= b.rootClientWidth,
            where + ': 盤面でページが横に伸びた（body.scrollWidth ' + b.bodyScrollWidth
            + 'px > ' + b.rootClientWidth + 'px）');
          assert.ok(b.rootScrollWidth <= b.rootClientWidth,
            where + ': 盤面でページが横に伸びた（documentElement.scrollWidth ' + b.rootScrollWidth
            + 'px > ' + b.rootClientWidth + 'px）');

          const o = measured[where].table.overflow;
          assert.equal(o.tableView.hidden, false, where + ': 表が出ていない前提が崩れた');
          assert.ok(o.tableView.clientWidth <= o.rootClientWidth,
            where + ': #table-view の幅 ' + o.tableView.clientWidth
            + 'px が画面の幅 ' + o.rootClientWidth + 'px を超えた');
          assert.ok(o.bodyScrollWidth <= o.rootClientWidth,
            where + ': ページが横に伸びた（body.scrollWidth ' + o.bodyScrollWidth
            + 'px > ' + o.rootClientWidth + 'px）');
          assert.ok(o.rootScrollWidth <= o.rootClientWidth,
            where + ': ページが横に伸びた（documentElement.scrollWidth ' + o.rootScrollWidth
            + 'px > ' + o.rootClientWidth + 'px）');
        });

        test('hidden を立てた要素が実ブラウザで描かれない', () => {
          const audit = measured[where].board.hidden.concat(measured[where].table.hidden);
          // 空振り防止。作成者オリジンの display: flex を持つ2つが必ず居ること。
          const has = (needle) => audit.some(function (h) { return h.what.indexOf(needle) === 0; });
          assert.ok(has('aside#panel'), where + ': hidden の #panel が測れていない');
          assert.ok(has('div#toast'), where + ': hidden の #toast が測れていない');
          const shown = audit.filter(function (h) { return h.display !== 'none' || h.rects > 0; });
          assert.deepEqual(shown, [],
            where + ': hidden を立てたのに描かれている要素がある'
            + '（作成者オリジンの display 指定が UA の [hidden]{display:none} に勝っている）');
        });

        test('見えているボタンの当たり判定が 24×24 CSS px 以上ある', () => {
          const board = measured[where].board.tap;
          const table = measured[where].table.tap;
          assert.ok(board.total >= 10, where + ': 盤面のボタンが ' + board.total + ' 件しか測れていない');
          assert.ok(table.total >= 5, where + ': 表のボタンが ' + table.total + ' 件しか測れていない');
          assert.deepEqual(board.tooSmall, [], where + ': 盤面に 24×24 未満のボタンがある');
          assert.deepEqual(table.tooSmall, [], where + ': 表に 24×24 未満のボタンがある');
        });

        test('見えている文字のコントラストが 4.5:1 以上ある', () => {
          [['盤面', measured[where].board.contrast], ['表', measured[where].table.contrast]]
            .forEach(function (entry) {
              const label = entry[0], c = entry[1];
              assert.ok(c.total >= 20, where + ' の' + label + ': 文字が ' + c.total + ' 件しか測れていない');
              assert.deepEqual(c.undecided, [],
                where + ' の' + label + ': 半透明が挟まって判定できない文字がある'
                + '（そのままだと実際より良い比を報告してしまう）');
              assert.deepEqual(c.failures, [], where + ' の' + label + ': 4.5:1 未満の文字がある');
            });
        });

        test('補足の ? を押すと補足だけが開き、周りは動かない', () => {
          // click は bubble する。カードの中に置いた ? は、止めないとカードの click まで
          // 届いてそのカードの編集パネルを開いてしまう（実際にそうなっていた）。
          // シムは bubble を再現しないので、ここでしか見えない。
          const m = measured[where];
          assertPressOpensOnlyTheHelp(m.board.pressColumnHeaderHelp, where);
          assertPressOpensOnlyTheHelp(m.board.pressCardHelp, where);
          assertPressOpensOnlyTheHelp(m.table.pressTableHeaderHelp, where);
        });

        test('通知は画面に収まり、重なった相手より手前に来て、取り消せる', () => {
          const t = measured[where].toast;
          assert.equal(t.panelHidden, false, where + ': 通知の最中にパネルが開いていない（前提が崩れた）');
          assert.equal(t.toast.hidden, false, where + ': 通知が出ていない');
          assert.equal(t.toast.rects, 1, where + ': 通知が描かれていない');
          assert.equal(t.toast.insideViewport, true,
            where + ': 通知が画面からはみ出している: ' + JSON.stringify(t.toast.rect));
          // 通知が重なった相手に負けて読めないなら、出ていないのと同じ（z-index を明示した理由）。
          assert.equal(t.toast.visibleRatio, 1,
            where + ': 通知が他の要素に隠れている（重なり順に負けている）');
          assert.equal(t.undoVisibleRatio, 1, where + ': 「取り消す」が隠れていて押せない');
          // 今は DOM 順で最前面になっているだけなので、z-index を消しても見た目は変わらない。
          // あとで position を持つ要素が足された瞬間に通知が黙って隠れるので、
          // 「重なり順を明示してある」ことそのものを固定しておく。
          assert.notEqual(t.toast.zIndex, 'auto',
            where + ': 通知の重なり順が明示されていない（DOM 順に頼っている）');
          assert.ok(t.toast.undo.width >= 24 - 0.01 && t.toast.undo.height >= 24 - 0.01,
            where + ': 「取り消す」の当たり判定が 24×24 未満: ' + JSON.stringify(t.toast.undo));
        });

        if (width <= NARROW_MAX) {
          test('狭い画面では、通知がパネルの操作部を覆わない', () => {
            // 通知を下端に置いたままだと、全幅で縦に積まれたパネルの入力欄・保存ボタンを
            // 10 秒間覆う。`@media (max-width: 900px)` で上端へ寄せたのがその対処。
            const t = measured[where].toast;
            assert.ok(t.controls.length >= 8,
              where + ': パネルの操作部が ' + t.controls.length + ' 件しか測れていない');
            assert.deepEqual(t.covered.map(function (c) { return c.what; }), [],
              where + ': 通知がパネルの操作部を覆っている');
          });
        } else {
          test('広い画面でも、通知は保存・削除・取り消すを覆わない', () => {
            // 広い画面では通知が下端に出るため、パネルの入力欄と重なる帯が残っている
            // （第2段階で park された既知の欠陥。task-9b-report.md に実測を載せた）。
            // 覆われるのが入力欄までに留まり、押せないと作業が止まるものへ広がらないことを
            // ここで固定する。直したら、上の狭い画面と同じ「1件も覆わない」に締め直すこと。
            const t = measured[where].toast;
            assert.ok(t.controls.length >= 8,
              where + ': パネルの操作部が ' + t.controls.length + ' 件しか測れていない');
            const blocking = t.covered.filter(function (c) {
              return /^button#panel-(save|delete)/.test(c.what);
            });
            assert.deepEqual(blocking.map(function (c) { return c.what; }), [],
              where + ': 通知が保存／削除ボタンを覆っている（10 秒間その作業が止まる）');
          });
        }
      });
    });
  });

  test('狭い画面では、表が枠より広い（＝枠の中で横スクロールしている）', () => {
    // これが無いと「ページが横に伸びない」は空振りしうる（表が枠に収まっていれば当然通る）。
    [375, 600].forEach(function (width) {
      const o = measured[keyOf(width, 'light')].table.overflow;
      assert.ok(o.tableView.scrollWidth > o.tableView.clientWidth,
        width + 'px: 表が枠に収まってしまい、横スクロールの検査が空振りしている（scrollWidth '
        + o.tableView.scrollWidth + ' / clientWidth ' + o.tableView.clientWidth + '）');
    });
  });

  test('viewport の meta を落とすと測定が成立せず、失敗になる', async () => {
    // 「meta の再現を忘れる」は黙って 980px 相当で描き、狭い画面の確認をまるごと
    // 無意味にする。忘れたら通るのではなく落ちることを、ここで実際に確かめる。
    const withoutMeta = buildStandalonePage({ omitViewportMeta: true });
    await assert.rejects(
      () => session.open({ html: withoutMeta, width: 375, height: HEIGHT, scheme: 'light' }),
      /指定した幅で描かれていません/,
      'viewport の meta が無くても 375px として測れてしまう（測定が前提を確かめていない）');
  });
});

// --- Chrome が無くても走る（組み立ての前提が実物とずれていないかの照合） -------------

test('単体ページの viewport meta を doGet の実装から読んでいる', () => {
  assert.equal(viewportContentFromDoGet(), 'width=device-width, initial-scale=1',
    'doGet の addMetaTag が変わった。単体ページの組み立ても追随しているか確かめること');
  const page = buildStandalonePage();
  assert.ok(page.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') !== -1,
    '組み立てた単体ページに viewport の meta が入っていない');
});

test('単体ページは kanban.html を書き換えず、代役だけを差し込んでいる', () => {
  const page = buildStandalonePage();
  assert.ok(page.indexOf('window.__pageToken') !== -1, '合言葉が入っていない（古いページを見分けられない）');
  assert.ok(page.indexOf('"apiGetView"') !== -1, 'google.script.run の代役が入っていない');
  // 見本は pure_* から作る。手書きの JSON にすると、本体の返す形が変わっても検査が通り続ける。
  assert.ok(page.indexOf('"columns"') !== -1, '見本の応答が入っていない');
});

test('表のビューのラベルが kanban.html の TABS に実在する', () => {
  // 測定は #views の「一覧」を押して表へ切り替える。ラベルが変わったら測れなくなるので、
  // Chrome が無い環境でもここで気づけるようにしておく。
  const fs = require('node:fs');
  const src = fs.readFileSync(require('./standalone_page.js').KANBAN_PATH, 'utf8');
  assert.ok(src.indexOf("label: '" + TABLE_VIEW_LABEL + "'") !== -1,
    'kanban.html の TABS に「' + TABLE_VIEW_LABEL + '」のビューが無い');
});
