/* eslint-env browser */
/**
 * ページの中で走る測定。**Node では動かない**（require しない。テストが本文を
 * 文字列として読み、Runtime.evaluate でページに流し込む）。
 *
 * 判定はすべて「実際に描かれた結果」から読む。CSS を解釈した結果でなければ、
 * DOM シムでも同じことが言えてしまい、この検査を足す意味が無い。
 */
(function () {
  'use strict';

  var root = document.documentElement;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function frame() { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); }
  function list(sel, host) { return Array.prototype.slice.call((host || document).querySelectorAll(sel)); }
  function txt(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  /** 要素を人が読める形で指す。落ちたときにどこの話か分かるようにする。 */
  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\s+/).join('.');
    }
    var t = txt(el);
    if (t) s += ' 「' + (t.length > 24 ? t.slice(0, 24) + '…' : t) + '」';
    return s;
  }

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }

  /**
   * その要素が「実際に見えている」割合。矩形の中に格子状の点を打ち、その点で
   * 一番手前にあるのが自分（か自分の中身）かを数える。
   *
   * 祖先の overflow に切り取られている・画面の外にはみ出している・何かに覆われている、
   * のどれでも 1.00 を割る。getBoundingClientRect だけでは切り取りが見えない。
   */
  function visibleRatio(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    var n = 7, hit = 0, total = 0;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var x = r.left + r.width * (i + 0.5) / n;
        var y = r.top + r.height * (j + 0.5) / n;
        total++;
        if (x < 0 || y < 0 || x >= root.clientWidth || y >= root.clientHeight) continue;  // 画面の外
        var top = document.elementFromPoint(x, y);
        if (top && (top === el || el.contains(top))) hit++;
      }
    }
    return total === 0 ? 0 : hit / total;
  }

  // --- 色 -------------------------------------------------------------------

  function parseColor(s) {
    var m = String(s).match(/^rgba?\(([^)]+)\)$/);
    if (!m) return null;
    var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function luminance(c) {
    var lin = [c.r, c.g, c.b].map(function (v) {
      var x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    var l1 = luminance(a), l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  /**
   * 背後の色。祖先を遡って最初に見つかった不透明な背景を採る。
   * 半透明が挟まると合成が要り、この検査では正しく出せないので「判定できない」を返す
   * （黙って不透明とみなすと、実際より良いコントラストを報告してしまう）。
   */
  function backdropOf(el) {
    var e = el;
    while (e) {
      var c = parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a >= 0.999) return { color: c };
      if (c && c.a > 0.001) return { undecided: describe(e) + ' の背景が半透明' };
      e = e.parentElement;
    }
    return { undecided: '不透明な背景が見つからない' };
  }

  /** 祖先までかけ合わせた不透明度。1 未満なら合成が要るので判定を保留する。 */
  function effectiveOpacity(el) {
    var o = 1, e = el;
    while (e) { o *= Number(getComputedStyle(e).opacity); e = e.parentElement; }
    return o;
  }

  function isVisible(el) {
    if (el.getClientRects().length === 0) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  /** 直下に文字を持つ（＝自分が描いている文字がある）要素か。 */
  function ownsText(el) {
    return Array.prototype.some.call(el.childNodes, function (n) {
      return n.nodeType === 3 && n.nodeValue.trim() !== '';
    });
  }

  // --- 測定 -----------------------------------------------------------------

  var probe = {
    /** 初回の読み込みが画面に反映されたか。 */
    boardReady: function () {
      var msg = document.getElementById('message');
      return (window.__calls || []).length > 0
        && txt(msg) === ''
        && document.getElementById('board').children.length > 0;
    },

    /** 表のビューが実データを描き終えたか（「読み込んでいます…」が残っていないか）。 */
    tableReady: function () {
      var host = document.getElementById('table-view');
      return !host.hidden && host.querySelectorAll('table').length > 0;
    },

    /** 「本当にこの条件で測っているか」を確かめるための実測値。 */
    viewport: function () {
      return {
        clientWidth: root.clientWidth, clientHeight: root.clientHeight,
        innerWidth: window.innerWidth,
        dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        metaViewport: (document.querySelector('meta[name=viewport]') || {}).content || null,
        pageErrors: (window.__errors || []).slice(),
        calls: (window.__calls || []).map(function (c) { return c.method + '(' + c.args.join(',') + ')'; }),
      };
    },

    /** ページが横に伸びていないか。表は枠の中で横スクロールしていること。 */
    overflow: function () {
      var tv = document.getElementById('table-view');
      var bd = document.getElementById('board');
      return {
        rootClientWidth: root.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        rootScrollWidth: root.scrollWidth,
        tableView: { hidden: tv.hidden, clientWidth: tv.clientWidth, scrollWidth: tv.scrollWidth },
        board: { hidden: bd.hidden, clientWidth: bd.clientWidth, scrollWidth: bd.scrollWidth },
      };
    },

    /**
     * `.column` の `min-width: 0` が明示されているか。
     *
     * `#board` / `.row > .field` の同種の `min-width: 0` は消すと「ページが横に伸びる」で
     * 落ちる（実測で確認済み）が、`.column` だけは消しても**今の見本では振る舞いに
     * 現れない**（実測で0件）。`.card .title` の `overflow-wrap: anywhere` が先に効いて
     * カードの中身を折り返すため、列の min-content がそもそも閾値に達しない。
     * 見本を歪めてまで振る舞いで落とすのは、実際には起こらない状況を検査に固定する
     * ことになるのでやらない。`z-index` と同じく、`.card .title` 側の折り返しが
     * 変わったときのための備えとして、宣言そのものが在ることを固定しておく。
     */
    columnMinWidth: function () {
      var col = document.querySelector('.column');
      return col ? getComputedStyle(col).minWidth : null;
    },

    /**
     * `td` の中に、途中で折り返せない長い連なり（URL、PBI-006 の見本）があれば、
     * そのセルの幅を測る。
     *
     * `.table-wrap`（= #table-view）は overflow-x: auto で自分の中に横スクロールを
     * 閉じ込めるため、`td { overflow-wrap: anywhere; }` を消しても「ページが横に
     * 伸びる」検査は空振りのまま通ってしまう（実測で確認済み）。かわりに、
     * 折り返せていれば要らないはずの幅（＝表の可視幅より広い1セル）を直接見る。
     * table は列の内容に合わせて幅を決める（table-layout: auto）ため、
     * 折り返せない連なりがあると、そのセルだけでなく表全体がそのぶん押し広げられる。
     */
    wideTokenCell: function () {
      var tv = document.getElementById('table-view');
      var marker = 'docs.google.com';   // PBI-006（fixtures.js）のタイトルに含まれる
      var td = list('td', tv).filter(function (el) {
        return (el.textContent || '').indexOf(marker) !== -1;
      })[0];
      if (!td) return { found: false };
      var r = td.getBoundingClientRect();
      return {
        found: true,
        tableViewClientWidth: tv.clientWidth,
        width: Math.round(r.width * 100) / 100,
      };
    },

    /**
     * hidden 属性が実ブラウザで本当に効いているか。
     * 作成者オリジンの display 指定は UA の [hidden]{display:none} に必ず勝つため、
     * `[hidden] { display: none !important; }` が無いと display: flex の要素は描かれ続ける。
     */
    hiddenAudit: function () {
      return list('[hidden]').map(function (el) {
        var s = getComputedStyle(el);
        return {
          what: describe(el),
          display: s.display,
          rects: el.getClientRects().length,
          rect: rectOf(el),
        };
      });
    },

    /** 見えているボタンの当たり判定（WCAG 2.5.8: 24×24 CSS px 以上）。 */
    tapTargets: function () {
      var all = list('button').filter(isVisible).map(function (b) {
        var r = b.getBoundingClientRect();
        return {
          what: describe(b),
          label: b.getAttribute('aria-label') || txt(b),
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100,
        };
      });
      return {
        total: all.length,
        tooSmall: all.filter(function (t) { return t.width < 24 - 0.01 || t.height < 24 - 0.01; }),
      };
    },

    /** 見えている文字のコントラスト（WCAG 1.4.3）。 */
    contrastAudit: function (min) {
      var threshold = min || 4.5;
      var out = { total: 0, min: Infinity, failures: [], undecided: [] };
      list('*').forEach(function (el) {
        if (!ownsText(el) || !isVisible(el)) return;
        var s = getComputedStyle(el);
        var fg = parseColor(s.color);
        if (!fg) return;
        if (effectiveOpacity(el) < 0.999) {
          out.undecided.push({ what: describe(el), why: '不透明度が 1 未満' });
          return;
        }
        var back = backdropOf(el);
        if (back.undecided) { out.undecided.push({ what: describe(el), why: back.undecided }); return; }
        if (fg.a < 0.999) { out.undecided.push({ what: describe(el), why: '文字色が半透明' }); return; }
        var ratio = contrast(fg, back.color);
        out.total++;
        if (ratio < out.min) out.min = ratio;
        if (ratio < threshold) {
          out.failures.push({
            what: describe(el),
            ratio: Math.round(ratio * 100) / 100,
            color: s.color, background: 'rgb(' + back.color.r + ',' + back.color.g + ',' + back.color.b + ')',
            fontSize: s.fontSize, fontWeight: s.fontWeight,
          });
        }
      });
      if (out.min === Infinity) out.min = null;
      return out;
    },

    /**
     * hostId の中の補足をひとつずつ開いて測る。
     *
     * 開く手は **mouseenter**（カーソルを当てる）を使う。理由が2つある:
     * - headless の Chrome は document.hasFocus() が false で、focus() を呼んでも
     *   focus イベントが飛ばない（activeElement は変わるのに開かない）。
     * - click は盤面のカードでは使えない。カードの ? を押すと click が .card まで
     *   上がってそのカードのパネルが開き、render(board) で盤面ごと描き直されて
     *   補足が捨てられる（本体の実バグ。task-9b-report.md に報告した）。
     *   ここで測りたいのは「開いた補足がどこにどう描かれるか」なので、その不具合に
     *   巻き込まれない手で開く。mouseenter は bubble しないので .card には届かない。
     *
     * 開く前に ? ボタンを画面内へスクロールする（実際に読む人の手順に合わせる）。
     * スクロールは開いている補足を閉じるので、必ずスクロールが終わってから開く。
     */
    helpAudit: async function (hostId) {
      var host = document.getElementById(hostId);
      var wraps = list('.help', host);
      var out = [];
      for (var i = 0; i < wraps.length; i++) {
        var wrap = wraps[i];
        var btn = wrap.querySelector('button');
        var body = wrap.querySelector('.help-body');
        if (!btn || !body) continue;
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        await frame();
        await sleep(60);   // スクロールの通知が届いて closeOpenHelp が走り終えるのを待つ
        btn.dispatchEvent(new MouseEvent('mouseenter'));
        await frame();
        var r = body.getBoundingClientRect();
        out.push({
          host: hostId,
          term: (btn.getAttribute('aria-label') || '').replace(/とは$/, ''),
          attached: document.contains(wrap),
          opened: !body.hidden && getComputedStyle(body).display !== 'none',
          expanded: btn.getAttribute('aria-expanded'),
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
          insideViewport: r.left >= -0.5 && r.top >= -0.5
            && r.right <= root.clientWidth + 0.5 && r.bottom <= root.clientHeight + 0.5,
          visibleRatio: Math.round(visibleRatio(body) * 1000) / 1000,
          scrollWidth: body.scrollWidth,
          clientWidth: body.clientWidth,
          buttonRect: rectOf(btn),
        });
        wrap.dispatchEvent(new MouseEvent('mouseleave'));
        await frame();
      }
      return out;
    },

    /**
     * 補足の ? を「指で1回タップした」ように押して、その結果を返す。
     *
     * click は bubble するので、補足が置かれた先（カードなど）の click ハンドラにも
     * 届きうる。届いてしまうと、押したのは補足なのに関係のないものが起こる。
     * ここで見たいのはまさにそれなので、開いたかどうかと**周りが動いていないか**の
     * 両方を返す。もう一度押して閉じることも併せて見る（止めたせいで開閉が壊れていないか）。
     *
     * @param {string} wrapSelector 補足の入れ物（.help）を指すセレクタ
     */
    pressHelp: async function (wrapSelector) {
      var wrap = document.querySelector(wrapSelector);
      if (!wrap) throw new Error(wrapSelector + ' に補足がありません');
      var btn = wrap.querySelector('button');
      var body = wrap.querySelector('.help-body');
      if (!btn || !body) throw new Error(wrapSelector + ' の補足に ? か本文がありません');
      var panel = document.getElementById('panel');
      var cardOf = function (el) { return el.closest ? el.closest('.card') : null; };
      var card = cardOf(wrap);

      btn.scrollIntoView({ block: 'center', inline: 'center' });
      await frame();
      await sleep(60);   // スクロールの通知で閉じられてから押す

      var before = { panelHidden: panel.hidden, bodyHidden: body.hidden };

      // タッチ端末での1タップ。カーソルが無いので合成の mouseenter は来ない。
      var tap = async function () {
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        btn.click();
        await frame();
      };

      await tap();
      var first = {
        stillAttached: document.contains(body),
        opened: !body.hidden && getComputedStyle(body).display !== 'none',
        expanded: btn.getAttribute('aria-expanded'),
        visibleRatio: document.contains(body) ? Math.round(visibleRatio(body) * 1000) / 1000 : 0,
        panelHidden: panel.hidden,
        panelTitle: txt(document.getElementById('panel-title')),
        cardSelected: card ? /(^|\s)selected(\s|$)/.test(card.className) : null,
      };

      // 描き直されていたら2回目は測れない。1回目の結果だけ返す。
      if (!document.contains(body)) return { where: wrapSelector, before: before, first: first, second: null };

      await tap();
      var second = {
        opened: !body.hidden && getComputedStyle(body).display !== 'none',
        expanded: btn.getAttribute('aria-expanded'),
        panelHidden: panel.hidden,
      };
      return { where: wrapSelector, before: before, first: first, second: second };
    },

    /**
     * 補足を開いたまま「外側」を押したときの振る舞いを測る。
     *
     * ここは実ブラウザでしか測れない。シム（kanban_harness.js）は伝播を再現しない
     * ので、document に捕捉フェーズで登録した listener へ「カードを押した」が届くか
     * どうかを確かめられず、押下を飲み込んでいないかも見られない（シムで押せるのは
     * その listener を直に呼ぶことだけで、それでは何も確かめたことにならない）。
     *
     * 3つを続けて測る。順序に依存があるので分けない（最後の1つは編集パネルを開く）。
     *  1. 無害な場所（#message）を押すと閉じる
     *  2. 本文の中を押しても閉じない（50字前後の説明をなぞって選び、コピーしたい）
     *  3. カードを押すと閉じ、かつその押下はカードまで届いている（飲み込んでいない）
     */
    helpOutsidePress: async function (wrapSelector) {
      var wrap = document.querySelector(wrapSelector);
      if (!wrap) throw new Error(wrapSelector + ' に補足がありません');
      var btn = wrap.querySelector('button');
      var body = wrap.querySelector('.help-body');
      if (!btn || !body) throw new Error(wrapSelector + ' の補足に ? か本文がありません');
      var panel = document.getElementById('panel');
      if (!panel.hidden) throw new Error('測る前から編集パネルが開いています');

      // タッチ端末での1タップ。カーソルが無いので合成の mouseenter は来ない。
      var tap = async function (el) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.click();
        await frame();
      };
      // 押しただけ（click は起こさない）。閉じる側の判定だけを見るときに使う。
      var pressOnly = async function (el) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await frame();
      };
      // 「開いた状態にする」。既に開いていれば押さない — ? の押下は開閉の切り替えなので、
      // 開いているのに押すと閉じてしまう（本文の中を押しても閉じない、を確かめた直後が
      // まさにその状態）。
      var open = async function (what) {
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        await frame();
        await sleep(60);   // スクロールの通知で閉じられてから開く
        if (body.hidden) await tap(btn);
        if (body.hidden) throw new Error(what + ' の前に補足を開けませんでした');
      };

      // 1. 無害な場所を押す。#message は押しても何も起こさない div。
      await open('外側を押す');
      await pressOnly(document.getElementById('message'));
      var outside = {
        stillAttached: document.contains(body),
        closed: body.hidden,
        expanded: btn.getAttribute('aria-expanded'),
        panelHidden: panel.hidden,
      };

      // 2. 本文の中を押す。閉じてはいけない。
      await open('本文の中を押す');
      await pressOnly(body);
      var inside = {
        stillOpen: !body.hidden && getComputedStyle(body).display !== 'none',
        expanded: btn.getAttribute('aria-expanded'),
      };

      // 3. カードを押す。閉じたうえで、その押下はカードまで届いていなければならない
      //    （補足はモーダルではない。開いている間もカードは操作できる）。
      //
      //    「届いた」は3つの目で見る。閉じる処理は document に**捕捉フェーズ**で
      //    載っているので、そこで stopPropagation() すれば pointerdown は的にすら
      //    届かず、preventDefault() すればドラッグの開始やフォーカスが消える。
      //    パネルが開いたかどうかだけでは、pointerdown を止めても click は別の
      //    イベントとして届くため、その2つを取りこぼす。
      await open('カードを押す');
      var card = document.querySelector('#board .card');
      if (!card) throw new Error('盤面にカードがありません');
      var reached = { pointerdown: false, click: false };
      var onDown = function () { reached.pointerdown = true; };
      var onClick = function () { reached.click = true; };
      card.addEventListener('pointerdown', onDown);
      card.addEventListener('click', onClick);
      var down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
      var notPrevented = card.dispatchEvent(down);
      card.click();
      await frame();
      card.removeEventListener('pointerdown', onDown);
      card.removeEventListener('click', onClick);
      var onCard = {
        // カードを押すとパネルが開き、盤面ごと描き直されるので補足は要素ごと消える。
        // 「閉じた」と「消えた」のどちらでも、開いたまま残っていないことに変わりはない。
        goneOrClosed: !document.contains(body) || body.hidden,
        // 押下そのものが的まで届いているか。
        pointerdownReachedCard: reached.pointerdown,
        clickReachedCard: reached.click,
        notPrevented: notPrevented && !down.defaultPrevented,
        // 届いた結果、カードが本来する仕事（編集パネルを開く）をしたか。
        panelOpened: !panel.hidden,
        panelTitle: txt(document.getElementById('panel-title')),
      };
      return { where: wrapSelector, outside: outside, inside: inside, onCard: onCard };
    },

    /**
     * 通知（#toast）が出ている最中にパネルを開き、通知がパネルの操作を覆っていないか測る。
     *
     * 第2段階で実際に苦しんだ組み合わせ（通知が下端にあると、狭い画面で全幅に積まれた
     * パネルの入力欄・保存ボタンを 10 秒間覆う）。`@media (max-width: 900px)` で通知を
     * 上端へ寄せたのがその対処で、`z-index` を明示したのも同じ場面のため。
     *
     * 手順は実際の道筋のとおり: 1件消して通知を出し、消えないうちに別のカードを開く。
     *
     * 消すカードは PBI-006（fixtures.js。URL を含む長いタイトル）を狙う。先頭カード
     * （PBI-001、短いタイトル）だと通知の文面が常に短く（実測 483px）、
     * `#toast { max-width: min(560px, 92vw); }` や `#toast-text` の overflow-wrap が
     * 効く場面が一度も来ない（実測で確認済み）。新しい見本は足さず、既存の PBI-006 を
     * 使い回す（表のセルの overflow-wrap を確かめたのと同じ手）。
     *
     * かつて本体に実バグがあり（`#toast-text` に overflow-wrap が無く、折り返せない
     * 連なりで「取り消す」が画面外へ押し出されて押せなくなっていた）、直した今も
     * その経路をここで測り続けることに意味がある。
     */
    toastOverPanel: async function () {
      var firstCard = document.querySelector('#board .card[data-id="PBI-006"]')
        || document.querySelector('#board .card');
      if (!firstCard) throw new Error('盤面にカードがありません');
      firstCard.click();                                  // パネルが開く
      await frame();
      document.getElementById('panel-delete').click();    // 削除 → 応答で通知が出る
      var until = Date.now() + 3000;
      while (document.getElementById('toast').hidden && Date.now() < until) await sleep(20);
      var toast = document.getElementById('toast');
      if (toast.hidden) throw new Error('削除しても通知が出ませんでした');

      // 通知が消えないうちに、別のカードのパネルを開く。
      var cards = list('#board .card');
      var next = cards[1] || cards[0];
      if (!next) throw new Error('盤面にカードが残っていません');
      next.click();
      await frame();
      var panel = document.getElementById('panel');
      if (panel.hidden) throw new Error('パネルが開きませんでした');

      var tr = toast.getBoundingClientRect();
      var intersects = function (a, b) {
        return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      };
      var view = { left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight };

      // パネルの中で人が触るもの。通知に覆われたら 10 秒間さわれない。
      // 画面の外にあるだけ（スクロールすれば届く）は「覆われた」に数えない
      // ——数えると、長いパネルではスクロール位置の話が混ざって判定が意味を失う。
      var controls = list('input, textarea, select, button', panel)
        .filter(isVisible)
        .map(function (el) {
          var r = el.getBoundingClientRect();
          return {
            what: describe(el),
            rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
            inViewport: intersects(r, view),
            overlappedByToast: intersects(r, tr),
            visibleRatio: Math.round(visibleRatio(el) * 1000) / 1000,
          };
        });

      var undo = document.getElementById('toast-undo');
      var ur = undo.getBoundingClientRect();
      // パネルは今まさに開いている（このすぐ上で next.click() した）。この幅の
      // 検査だけのために開閉をやり直すのは無駄なので、ここで一緒に測る。
      // 900px 以下は #panel { flex: 1 1 auto; width: 100%; } で全幅にする設計なので
      // 380px と一致しない（意図どおり）。判定は呼び出し側で幅を見て行う。
      var panelRect = panel.getBoundingClientRect();
      return {
        panelWidth: {
          declared: getComputedStyle(root).getPropertyValue('--panel-w').trim(),
          actual: Math.round(panelRect.width * 100) / 100,
        },
        toast: {
          hidden: toast.hidden,
          rects: toast.getClientRects().length,
          rect: rectOf(toast),
          // 重なり順を明示しているか。今は DOM 順で最前面になっているだけなので、
          // これを消しても見た目は変わらない（＝測定では捕まえられない）。
          // 「あとで position を持つ要素が足されたときに黙って隠れない」ための備えなので、
          // 備えが在ることそのものを見る。
          zIndex: getComputedStyle(toast).zIndex,
          insideViewport: tr.left >= -0.5 && tr.top >= -0.5
            && tr.right <= root.clientWidth + 0.5 && tr.bottom <= root.clientHeight + 0.5,
          // 通知は「今起きたことを伝えるもの」。重なった相手に負けて読めないなら意味が無い。
          visibleRatio: Math.round(visibleRatio(toast) * 1000) / 1000,
          undo: { width: Math.round(ur.width * 100) / 100, height: Math.round(ur.height * 100) / 100 },
        },
        panelHidden: panel.hidden,
        controls: controls,
        // 通知の矩形と重なっている操作部。重なりは幾何で決める（可視率は境界の
        // 標本点が親に当たって 1 を僅かに割ることがあり、覆いの判定には向かない）。
        covered: controls.filter(function (c) { return c.inViewport && c.overlappedByToast; }),
        undoVisibleRatio: Math.round(visibleRatio(undo) * 1000) / 1000,
      };
    },

    /**
     * パネルが閉じている状態で通知が中央にあるか測る。
     *
     * `@media (min-width: 901px) #main:has(#panel:not([hidden])) ~ #toast` は
     * パネルが開いている間**だけ**通知を寄せる意図（`:not([hidden])`）。閉じている
     * ときにこの上書きが誤って効く（例: `:not([hidden])` を落として `:has(#panel)`
     * にする）と、通知は画面の中央から動いたままになるが、`toastOverPanel()` は
     * パネルを開いた状態でしか測っていないため、その退行を検出できない。
     *
     * 手順: カードを開いて削除する。本体は削除に成功すると closePanel() してから
     * 通知を出すため（kanban.html の deletePbi）、追加の操作なしでパネルが
     * 閉じた状態の通知が作れる。
     */
    toastCenteredWhilePanelClosed: async function () {
      var firstCard = document.querySelector('#board .card');
      if (!firstCard) throw new Error('盤面にカードがありません');
      firstCard.click();
      await frame();
      var panel = document.getElementById('panel');
      if (panel.hidden) throw new Error('パネルが開きませんでした（前提が崩れた）');
      document.getElementById('panel-delete').click();

      var toast = document.getElementById('toast');
      var until = Date.now() + 3000;
      while (toast.hidden && Date.now() < until) await sleep(20);
      if (toast.hidden) throw new Error('削除しても通知が出ませんでした');
      await frame();

      if (!panel.hidden) throw new Error('削除後もパネルが開いたままだった（前提が崩れた）');
      var r = toast.getBoundingClientRect();
      return {
        panelHidden: panel.hidden,
        centerX: Math.round((r.left + r.right) / 2 * 100) / 100,
        rootHalf: Math.round(root.clientWidth / 2 * 100) / 100,
      };
    },

    /** #tabs / #views のボタンをラベルで押す。 */
    clickIn: function (hostId, label) {
      var b = list('button', document.getElementById(hostId)).filter(function (x) { return txt(x) === label; })[0];
      if (!b) throw new Error(hostId + ' に「' + label + '」のボタンがありません');
      b.click();
      return true;
    },
  };

  window.__probe = probe;
})();
