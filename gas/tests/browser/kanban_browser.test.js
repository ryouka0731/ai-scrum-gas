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

const { chromePath, launch, chromeArgs } = require('./chrome_session.js');
const { buildStandalonePage, viewportContentFromDoGet } = require('./standalone_page.js');
const { responses, VIEW_NAMES } = require('./fixtures.js');
const {
  measureOne, installProbe, WIDTHS, SCHEMES, HEIGHT, TABLE_VIEW_LABEL, HELP_PRESS_SPOTS,
} = require('./measure.js');

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

        test('表の中の折り返せない連なりは、表の枠より広くならない', () => {
          // `.table-wrap`（= #table-view）は overflow-x: auto で横スクロールを自分の中に
          // 閉じ込めるため、「ページが横に伸びない」検査は `td { overflow-wrap: anywhere; }`
          // を消しても空振りのまま通ってしまう（実測で確認済み）。折り返せていれば、
          // PBI-006 の URL を持つセル1つが表の可視幅より広くなる理由が無いことを直接見る。
          const c = measured[where].table.wideCell;
          assert.equal(c.found, true, where + ': URL を含むセルが見つからない（PBI-006 の見本が変わった？）');
          assert.ok(c.width <= c.tableViewClientWidth,
            where + ': URL のセルが表の可視幅（' + c.tableViewClientWidth
            + 'px）より広い（' + c.width + 'px）。折り返せていない');
        });

        test('.column の min-width: 0 が明示されている', () => {
          // `#board` / `.row > .field` の同種の min-width: 0 は消すと落ちるが、`.column` は
          // `.card .title` の overflow-wrap が先に折り返すため、消しても今の見本では
          // 振る舞いに現れない（実測で確認済み）。見本を歪めてまで振る舞いで落とすのは
          // 実際には起こらない状況を検査に固定することになるのでやらない。z-index と同じく
          // 「備えが在ること」（宣言そのもの）を固定しておく（`.card .title` 側が変わった
          // ときのための備え）。
          assert.equal(measured[where].board.columnMinWidth, '0px',
            where + ': .column の min-width: 0 が明示されていない');
        });

        test('パネルの幅は、宣言どおり（380px）になる', () => {
          // 901px 以上でだけ判定する。900px 以下は #panel { flex: 1 1 auto; width: 100%; }
          // で全幅にする設計で、380px と一致しないのが正しい（別の検査が既にその全幅を見ている）。
          if (width <= 900) return;
          const p = measured[where].toast.panelWidth;
          assert.equal(p.declared, '380px', where + ': --panel-w の宣言値が変わった');
          assert.equal(p.actual, 380,
            where + ': パネルの実測幅が宣言（380px）と違う（' + p.actual
            + 'px）。flex 項目の自動的な最小の幅が下限になっている可能性がある');
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
          // 消すのは PBI-006（URL を含む長いタイトル）。かつて本体に実バグがあり
          // （`#toast-text` に overflow-wrap が無く、折り返せない連なりで「取り消す」が
          // 画面外へ押し出されて押せなくなっていた。375px でも 1440px でも起きていた）、
          // 直した今もこの経路（可視率・当たり判定の両方）で退行を検出できる。
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

        test('通知の幅は、宣言どおり（min(560px, 92vw)）を超えない', () => {
          // `#toast-text` が折り返すようになった今、通知の見た目（画面に収まる・
          // 覆わない）だけでは `max-width` を消しても落ちない（実測で確認済み。
          // 折り返しさえすればどんな幅でも画面には収まってしまうため）。
          // `#panel` の幅と同じく、宣言した上限そのものを直接測る。
          const t = measured[where].toast;
          const limit = Math.min(560, 0.92 * width);
          assert.ok(t.toast.rect.width <= limit + 0.5,
            where + ': 通知の幅が min(560px, 92vw)（' + limit + 'px）を超えている（'
            + t.toast.rect.width + 'px）');
        });

        test('通知がパネルの操作部を覆わない', () => {
          // 通知は10秒消えない。その間その入力欄が触れなくなるが、利用者からは
          // 「保存した直後に特定の欄だけ反応しなくなり、しばらくすると直る」としか
          // 見えず、壊れているのか自分の操作が悪いのか判断できない。
          // 狭い画面は上端へ寄せる（`@media (max-width: 900px)`）、広い画面は
          // パネルの外側へ寄せる（`@media (min-width: 901px)` の `:has()`）で避けている。
          const t = measured[where].toast;
          assert.ok(t.controls.length >= 8,
            where + ': パネルの操作部が ' + t.controls.length + ' 件しか測れていない');
          assert.deepEqual(t.covered.map(function (c) { return c.what; }), [],
            where + ': 通知がパネルの操作部を覆っている');
        });

        test('パネルが閉じているときは、通知が画面の中央のまま', () => {
          // `@media (min-width: 901px) #main:has(#panel:not([hidden])) ~ #toast` は
          // パネルが開いている間だけ通知を寄せる意図（:not([hidden]) がその境目）。
          // 上のテストはパネルが開いた状態でしか見ていないため、この境目が壊れて
          // 閉じていても寄ったまま（またはその逆）になる退行を検出できない。
          //
          // 375/600px は対象外にしている。理由（切り分け済み）:
          // toastOverPanel（PBI-006。overflow-wrap: anywhere が文字の途中で強制的な
          // 折り返しを起こす連なりを消す）の直後にここで別のカードを消すと、
          // #toast の中央寄せが崩れる（left が本来の 15px ではなく 178.5px になる）。
          // 「待てば消える揺れ」ではない: 3秒（300ms×10回）待っても直らず、
          // document.body.style.display を none→'' に戻す強制リフローでも直らない。
          // ただし window.scrollTo(50, 0) を呼んでも scrollX は 0 のままで、
          // 実際にページがスクロールできるわけではない。body 配下を全走査しても
          // #toast 自身とその子孫以外に画面幅を超える要素は無い。
          // 最初に消すカードを PBI-002（長いが CJK で折り返せるタイトル。通知は
          // 同じく max-width の345pxに達する）に変えると再現しない。
          // **`Emulation.setDeviceMetricsOverride` の `mobile: false` で同じ手順を
          // 踏むと、この崩れ（toastLeft のずれ）自体が起こらない**（`documentElement.
          // scrollWidth` は 702 のままで謎は残るが、`#toast` の位置は正しく 15px に
          // 戻る）ことを確かめた。つまり退行の見た目（中央寄せが崩れる）は
          // `mobile: true` のエミュレーション（レイアウトビューポートの扱い）に
          // 固有で、`gas/kanban.html` 側の CSS の不具合ではないと判断した。
          // このテスト一式は breakpoint の検証のため常に `mobile: true` で開いており
          // （chrome_session.js の open() 参照）、この1検査のためだけに別セッション
          // （`mobile: false`）を割くのは道具立てが重くなるため、対象を絞る形にした。
          if (width <= 600) return;
          const t = measured[where].toastClosed;
          assert.equal(t.panelHidden, true, where + ': パネルが閉じていない（前提が崩れた）');
          assert.equal(t.centerX, t.rootHalf,
            where + ': パネルが閉じているのに通知が画面の中央にない（中心 ' + t.centerX
            + 'px / 画面の半分 ' + t.rootHalf + 'px）');
        });
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

  test('スプリントゴールの折り返せない連なりで、375px のページが横に伸びない', async () => {
    // #summary .goal（overflow-wrap: anywhere）は board/list ビューには出ない
    // （summarizeBacklog() の結果に goal が無い）ため、上の行列では一度も測っていない。
    // スプリントゴールは sprint_backlog.md に人が書く文章（SPRINT_MD、fixtures.js）で、
    // URL を貼ることは普通にある。心配なのはそこだけなので、ビューの計測を行列に
    // 足さず、375px 単体でここだけ見る。
    const width = 375;
    await session.open({ html: html, width: width, height: HEIGHT, scheme: 'light' });
    await installProbe(session);
    await session.waitFor('return window.__probe.boardReady() ? 1 : 0', width + 'px の初回読み込み');
    await session.evaluate('return window.__probe.clickIn("tabs", "スプリント");');
    await session.evaluate('return window.__probe.clickIn("views", "バーンダウン");');
    await session.waitFor('return document.querySelector("#summary .goal") ? 1 : 0',
      width + 'px のスプリントゴールの表示');

    const goalText = await session.evaluate(
      'return (document.querySelector("#summary .goal") || {}).textContent || "";');
    assert.ok(goalText.indexOf('docs.google.com') !== -1,
      'スプリントゴールの見本が変わった（URL を含む文言が見つからない）: ' + goalText);

    const o = await session.evaluate('return window.__probe.overflow();');
    assert.ok(o.bodyScrollWidth <= o.rootClientWidth,
      width + 'px: スプリントゴールでページが横に伸びた（body.scrollWidth ' + o.bodyScrollWidth
      + 'px > ' + o.rootClientWidth + 'px）');
    assert.ok(o.rootScrollWidth <= o.rootClientWidth,
      width + 'px: スプリントゴールでページが横に伸びた（documentElement.scrollWidth '
      + o.rootScrollWidth + 'px > ' + o.rootClientWidth + 'px）');
  });

  test('補足は外側を押すと閉じ、その押下は飲み込まれない', async () => {
    // 設計書 §専門用語には補足を付ける:「Escape と、外側を押すことで閉じる」。
    // 外側を押す以外の閉じ手（wrap の mouseleave / ? の blur）は、カーソルの無い
    // タッチ端末では来ない・来る保証がない。ここが無いと、補足が開いたまま閉じられない。
    //
    // 行列（12条件）には足さない。閉じるかどうかは幅にも配色にも依らず、
    // 最後にカードを押して編集パネルを開くので、他の測定の前提を壊すため。
    const width = 1024;
    await session.open({ html: html, width: width, height: HEIGHT, scheme: 'light' });
    await installProbe(session);
    await session.waitFor('return window.__probe.boardReady() ? 1 : 0', width + 'px の初回読み込み');

    const r = await session.evaluate('return window.__probe.helpOutsidePress('
      + JSON.stringify(HELP_PRESS_SPOTS.columnHeader) + ');');

    assert.equal(r.outside.stillAttached, true,
      '外側を押したら補足が DOM から外れた（閉じたのではなく周りが描き直された）');
    assert.equal(r.outside.closed, true, '外側を押しても補足が閉じない');
    assert.equal(r.outside.expanded, 'false', '外側を押しても aria-expanded が閉じた状態にならない');
    assert.equal(r.outside.panelHidden, true, '外側を押したら関係のない編集パネルが開いた');

    assert.equal(r.inside.stillOpen, true,
      '補足の本文を押したら閉じた（文面をなぞって選べない）');
    assert.equal(r.inside.expanded, 'true', '本文を押したら aria-expanded が閉じた状態になった');

    assert.equal(r.onCard.goneOrClosed, true, 'カードを押しても補足が開いたまま残っている');
    // 以下4つが「押下を飲み込んでいない」の中身。補足はモーダルではなく、
    // 開いている間もドラッグもカードの操作もできるのがこの画面の設計である。
    assert.equal(r.onCard.pointerdownReachedCard, true,
      '閉じる処理が pointerdown を捕捉フェーズで止めており、押下がカードまで届いていない');
    assert.equal(r.onCard.notPrevented, true,
      '閉じる処理が pointerdown の既定動作を打ち消している（ドラッグの開始が消える）');
    assert.equal(r.onCard.clickReachedCard, true, '押下がカードの click まで届いていない');
    assert.equal(r.onCard.panelOpened, true,
      'カードを押したのに編集パネルが開かない（押下が本来の仕事に繋がっていない）');
    assert.ok(r.onCard.panelTitle, '編集パネルは開いたが、どの PBI か分からない');

    const errors = await session.evaluate('return (window.__errors || []).slice();');
    assert.deepEqual(errors, [], 'ページで JS 例外が出ている');
  });

  test('削除の通知の「取り消す」を押すと、実際に戻す要求が飛ぶ', async () => {
    // 「取り消せる」の検査（12条件）が見ているのは当たり判定と可視率だけで、
    // 押していない。見本の応答が removed: null を返していると、押した先は
    // restorePbi の「取り消せませんでした」の枝になるが、それでも通ってしまう。
    // ここで押した結果まで見る（本物の apiDeletePbi は消した行そのものを返す）。
    //
    // 行列（12条件）には足さない。押した結果は幅にも配色にも依らず、
    // 盤面の状態を変えるので他の測定の前提を壊す。
    const width = 1024;
    await session.open({ html: html, width: width, height: HEIGHT, scheme: 'light' });
    await installProbe(session);
    await session.waitFor('return window.__probe.boardReady() ? 1 : 0', width + 'px の初回読み込み');

    const r = await session.evaluate('return window.__probe.undoDelete();');

    assert.equal(r.toastHidden, true, '「取り消す」を押しても通知が出たまま');
    assert.equal(r.method, 'apiRestorePbi',
      '「取り消す」を押しても戻す要求が飛んでいない（飛んだのは ' + r.method + '）');
    assert.equal(r.sentId, r.deletedId,
      '消した ' + r.deletedId + ' ではなく ' + r.sentId + ' を戻そうとしている');
    assert.notEqual(r.messageKind, 'error', '取り消しが失敗している: ' + r.message);
    assert.ok(r.message.indexOf('戻しました') !== -1, '戻した旨が出ていない: ' + r.message);

    const errors = await session.evaluate('return (window.__errors || []).slice();');
    assert.deepEqual(errors, [], 'ページで JS 例外が出ている');
  });

  test('バーンダウンのビューが実ブラウザで表として描かれる', async () => {
    // 見本の burndown は buildBurndownView(ROWS, VELOCITY) と呼んでいた。あの関数が
    // 受け取るのは sprint_backlog.md の本文ひとつだけなので view はずっと null で、
    // 7つあるビューのうちここだけ実ブラウザで一度も表を描いていなかった。
    // 「見本を直したつもりで、まだ null だった」を画面の側から塞ぐ。
    const width = 1024;
    await session.open({ html: html, width: width, height: HEIGHT, scheme: 'light' });
    await installProbe(session);
    await session.waitFor('return window.__probe.boardReady() ? 1 : 0', width + 'px の初回読み込み');
    await session.evaluate('return window.__probe.clickIn("tabs", "スプリント");');
    await session.evaluate('return window.__probe.clickIn("views", "バーンダウン");');
    await session.waitFor('return window.__probe.tableReady() ? 1 : 0', 'バーンダウンの表の読み込み');

    const t = await session.evaluate(
      'var host = document.getElementById("table-view");'
      + 'return {'
      + '  rows: host.querySelectorAll("table tbody tr").length,'
      + '  headers: Array.prototype.map.call(host.querySelectorAll("table thead th"),'
      + '    function (e) { return (e.textContent || "").replace(/[?？]$/, "").trim(); }),'
      + '  text: (host.textContent || "").trim()'
      + '};');

    assert.equal(t.rows, 4, 'バーンダウンの行が描かれていない: ' + JSON.stringify(t));
    assert.deepEqual(t.headers, ['日付', '残タスク数', '残ポイント'],
      'バーンダウンの見出しが見本と違う: ' + JSON.stringify(t.headers));
    assert.equal(t.text.indexOf('まだありません'), -1,
      'バーンダウンが「まだありません。」のまま（見本の view がまだ null）');

    const errors = await session.evaluate('return (window.__errors || []).slice();');
    assert.deepEqual(errors, [], 'ページで JS 例外が出ている');
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

// 見本そのものの検査（Chrome が無くても走る）。
//
// 「引数を取り違えて null のまま」「空の配列を渡していて表が出ない」は、画面側の
// 検査からは「たまたま何も起きていない」としか見えず、静かに空振りする。この案件では
// 実際に burndown で1段階まるごと見逃している。見本の側で先に止める。
test('見本の7つのビューが、どれも描くものを持っている', () => {
  const res = responses();

  /** そのビューが実際に描く行の数。形はビューごとに違う（renderTable の分岐と同じ）。 */
  function rowCountOf(view) {
    if (!view) return 0;
    if (view.table) return view.table.rows.length;
    if (view.open !== undefined && view.resolved !== undefined) return view.open.length + view.resolved.length;
    if (view.rows) return view.rows.length;   // 一覧・完了（columns も持つので先に見る）
    if (view.columns) {                        // 盤面（columns は列で、中にカードが入る）
      return view.columns.reduce(function (n, c) { return n + c.cards.length; }, 0);
    }
    return 0;
  }

  VIEW_NAMES.forEach(function (name) {
    const r = res[name];
    assert.ok(r, name + ' の見本がない');
    assert.equal(r.ok, true, name + ' の見本が ok:false');
    assert.ok(r.view, name + ' の見本の view が null（画面には「まだありません。」しか出ない）');
    assert.ok(rowCountOf(r.view) > 0,
      name + ' の見本が0行（画面には「ありません。」しか出ず、その画面の検査が空振りする）');
  });
});


// ---------------------------------------------------------------------------
// Chrome の起こし方・片付け方
// ---------------------------------------------------------------------------

test('root では --no-sandbox を付ける（付けないと起動すらしない）', () => {
  // コンテナ等で root のまま走らせると、Chrome は
  // 'Running as root without --no-sandbox is not supported' と言って即座に終了する。
  // ここは実際に root になれないので、引数の組み立てだけを両方向で確かめる。
  const real = process.getuid;
  try {
    process.getuid = function () { return 0; };
    assert.ok(chromeArgs(9999, '/tmp/x').indexOf('--no-sandbox') !== -1,
      'root なのに --no-sandbox が無い（起動直後に終了する）');
    process.getuid = function () { return 501; };
    assert.equal(chromeArgs(9999, '/tmp/x').indexOf('--no-sandbox'), -1,
      'root でないのに sandbox を外している');
  } finally {
    process.getuid = real;
  }
  // 引数の末尾は開くページ。ここが崩れると Chrome は何も開かない。
  assert.equal(chromeArgs(9999, '/tmp/x').pop(), 'about:blank');
});

test('シグナルで死んだ Chrome の片付けで待たされない', { skip: SKIP }, async () => {
  // exit イベントの code は**シグナル死のとき null**。終了の有無を code で持つと
  // 「まだ生きている」と見分けが付かず、close() は既に起きた exit を 3 秒待つ
  // （起動待ちのほうも、死んだことに気づかず 20 秒空回りする）。
  const session = await launch();
  process.kill(session.pid, 'SIGKILL');
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    try { process.kill(session.pid, 0); } catch (_) { break; }   // ESRCH = もう居ない
    await new Promise(function (r) { setTimeout(r, 20); });
  }
  const started = Date.now();
  await session.close();
  const took = Date.now() - started;
  assert.ok(took < 1000, '既に死んでいる Chrome の片付けに ' + took + 'ms かかっている');
});

test('measure.js は配色の打ち間違いを黙って light として測らない', { skip: SKIP }, async () => {
  // 幅の打ち間違いは NaN が clientWidth の照合で落ちる。配色は `dark` 以外がすべて
  // 「light の期待」になるので、照合をすり抜けて別の色を測りうる（Chromium は
  // 値が不正だと上書きそのものを捨て、端末の設定のままになる。light の端末では
  // 期待も実測も light で一致してしまう）。起こす前に落とす。
  const { execFile } = require('node:child_process');
  const script = require('node:path').join(__dirname, 'measure.js');
  const r = await new Promise(function (resolve) {
    execFile(process.execPath, [script, '375', 'drak'], function (err, stdout, stderr) {
      resolve({ code: err ? err.code : 0, stdout: stdout, stderr: stderr });
    });
  });
  assert.equal(r.code, 1, '打ち間違いのまま測り始めている: ' + r.stdout.slice(0, 200));
  assert.ok(r.stderr.indexOf('drak') !== -1, '何が悪いのか分からない文面: ' + r.stderr);
});
