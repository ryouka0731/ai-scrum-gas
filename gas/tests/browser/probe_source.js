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
