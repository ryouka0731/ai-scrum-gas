'use strict';
// バグ探し D の乱択ファザ（テストファイルではない）。
// 利用者の操作列と、各ステップでの「サーバで処理する呼び出し」「届ける応答」を種から決めて走らせ、
// 静止（全応答の到達・タイマー消化）後と、最後の「最新にする」の後に不変条件を検査する。

const W = require('./bughunt_d_world.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function isHiddenUp(el) { for (let n = el; n; n = n.parentNode) if (n.hidden) return true; return false; }

/**
 * 1つの操作の候補を作る。各候補は { name, args, run(world) }。run は前提が崩れていたら false を返す。
 * 操作は replay できるよう、名前と引数だけで再現できるようにする。
 */
const OPS = {
  drag: function (w, id, to) {
    const h = w.h;
    if (h.tabState().views.length && !h.tabState().views.some(function (v) { return v.label === '盤面' && v.selected; })) return false;
    if (w.el('board').hidden) return false;
    const ids = [].concat.apply([], h.screen().map(function (c) { return c.cards; }));
    if (ids.indexOf(id) === -1) return false;
    const from = h.screen().filter(function (c) { return c.cards.indexOf(id) !== -1; })[0].status;
    if (from === to) return false;
    h.drag(id, to);
    return true;
  },
  openCard: function (w, id) {
    if (w.el('board').hidden) return false;
    const ids = [].concat.apply([], w.h.screen().map(function (c) { return c.cards; }));
    if (ids.indexOf(id) === -1) return false;
    w.h.openCard(id);
    return true;
  },
  addCard: function (w, status) {
    if (w.el('board').hidden) return false;
    w.h.clickAdd(status);
    return true;
  },
  editTitleSave: function (w, title) {
    if (w.el('panel').hidden || w.h.disabledOf('panel-save')) return false;
    w.h.setValue('f-title', title);
    w.h.click('panel-save');
    return true;
  },
  deletePbi: function (w) {
    if (w.el('panel').hidden || w.el('panel-delete').hidden || w.h.disabledOf('panel-delete')) return false;
    w.h.click('panel-delete');
    return true;
  },
  closePanel: function (w) {
    if (w.el('panel').hidden) return false;
    w.h.click('panel-close');
    return true;
  },
  escape: function (w) { w.h.pressKey('Escape'); return true; },
  toastAction: function (w) {
    if (w.el('toast').hidden) return false;
    w.h.click('toast-undo');
    return true;
  },
  timers: function (w) { w.h.flushTimers(); return true; },
  tab: function (w, label) {
    if (w.h.tabState().tabs.some(function (t) { return t.label === label && t.selected; })) return false;
    w.h.clickTab(label);
    return true;
  },
  view: function (w, label) {
    const views = w.h.tabState().views;
    if (w.h.tabState().viewsHidden || !views.some(function (v) { return v.label === label; })) return false;
    w.h.clickView(label);
    return true;
  },
  reload: function (w) { w.h.click('reload'); return true; },
  commentAdd: function (w, host, body) {
    const panel = host === 'panel-comments' ? 'panel' : 'imp-panel';
    if (w.el(panel).hidden || w.el(host).hidden) return false;
    const f = w.h.commentFormOf(host);
    if (f.inputDisabled) return false;
    w.h.setCommentInput(host, body);
    w.h.clickCommentSend(host);
    return true;
  },
  commentDelete: function (w, host, idx) {
    const panel = host === 'panel-comments' ? 'panel' : 'imp-panel';
    if (w.el(panel).hidden || w.el(host).hidden) return false;
    const mine = w.h.commentsIn(host).filter(function (c) { return c.canDelete; });
    if (!mine.length) return false;
    w.h.clickCommentDelete(host, mine[idx % mine.length].id);
    return true;
  },
  historyToggle: function (w, host) {
    const panel = host === 'panel-history' ? 'panel' : 'imp-panel';
    if (w.el(panel).hidden || w.el(host).hidden) return false;
    w.h.historyToggle(host);
    return true;
  },
  impOpen: function (w, id) {
    if (w.el('table-view').hidden) return false;
    const trs = W.collect(w.activeTable(), function (e) { return e.tagName === 'tr' && e.dataset.id === id; });
    if (trs.length !== 1) return false;
    w.h.clickImpRow(id);
    return true;
  },
  impAdd: function (w) {
    if (w.el('table-view').hidden) return false;
    const b = W.collect(w.activeTable(), function (e) { return e.id === 'imp-add'; });
    if (b.length !== 1) return false;
    w.h.clickImpAdd();
    return true;
  },
  impSave: function (w, title) {
    if (w.el('imp-panel').hidden || w.h.disabledOf('imp-panel-save')) return false;
    w.h.setValue('i-title', title);
    if (!w.h.valueOf('i-reported-by')) w.h.setValue('i-reported-by', 'me');   // 作成は報告者が必須
    w.h.click('imp-panel-save');
    return true;
  },
  impResolve: function (w, text) {
    if (w.el('imp-panel').hidden || w.el('imp-panel-resolve').hidden || w.h.disabledOf('imp-panel-resolve')) return false;
    if (!w.h.hiddenOf('i-resolution-field')) w.h.setValue('i-resolution', text);
    w.h.click('imp-panel-resolve');
    return true;
  },
  impCancelResolve: function (w) {
    if (w.el('imp-panel').hidden || w.el('imp-panel-cancel-resolve').hidden) return false;
    w.h.click('imp-panel-cancel-resolve');
    return true;
  },
  impClose: function (w) {
    if (w.el('imp-panel').hidden) return false;
    w.h.click('imp-panel-close');
    return true;
  },
  pending: function (w, which) {
    if (w.el('table-view').hidden) return false;
    const b = W.collect(w.activeTable(), function (e) { return typeof e.id === 'string' && e.id.indexOf('imp-pending-' + which + '-') === 0; });
    if (!b.length) return false;
    w.h.clickPending(b[0].id.slice(('imp-pending-' + which + '-').length), which);
    return true;
  },
  // --- 届け方 ---
  process: function (w, n, kind) {
    if (w.unprocessedNs().indexOf(n) === -1) return false;
    const m = w.methodOf(n);
    if (kind === 'busy' && /apiGetView|apiGetHistory/.test(m)) kind = 'ok';
    if (kind === 'partial' && !/apiResolveImpediment|apiUnresolveImpediment/.test(m)) kind = 'ok';
    w.process(n, kind);
    return true;
  },
  deliver: function (w, n) {
    if (w.processedNs().indexOf(n) === -1) return false;
    w.deliver(n);
    return true;
  },
  fail: function (w, n) {
    if (w.unprocessedNs().indexOf(n) === -1) return false;
    w.deliver(n);
    return true;
  },
};

/** 乱数から次の操作を選ぶ。 */
function pickOp(rnd, w, cfg, counter) {
  const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
  const r = rnd();
  const un = w.unprocessedNs();
  const pr = w.processedNs();
  if (r < 0.45 && (un.length || pr.length)) {
    const r2 = rnd();
    if (un.length && (r2 < 0.5 || !pr.length)) {
      const k = rnd();
      const kind = k < cfg.busy ? 'busy' : k < cfg.busy + cfg.partial ? 'partial' : 'ok';
      // fifoServer: サーバは発行順に処理する（届く順だけを乱す）。
      const target = cfg.fifoServer ? Math.min.apply(null, un) : pick(un);
      if (rnd() < cfg.fail) return ['fail', target];
      return ['process', target, kind];
    }
    return ['deliver', pick(pr)];
  }
  counter.n++;
  const ids = ['PBI-001', 'PBI-002', 'PBI-003', 'PBI-004', 'PBI-005', 'PBI-006'];
  const imps = ['IMP-001', 'IMP-002', 'IMP-003', 'IMP-005', 'IMP-006'];
  const choices = cfg.ops;
  const name = pick(choices);
  switch (name) {
    case 'drag': return ['drag', pick(ids), pick(STATUSES)];
    case 'openCard': return ['openCard', pick(ids)];
    case 'addCard': return ['addCard', pick(STATUSES)];
    case 'editTitleSave': return ['editTitleSave', 't' + counter.n];
    case 'commentAdd': return ['commentAdd', pick(['panel-comments', 'imp-panel-comments']), 'c' + counter.n];
    case 'commentDelete': return ['commentDelete', pick(['panel-comments', 'imp-panel-comments']), Math.floor(rnd() * 4)];
    case 'historyToggle': return ['historyToggle', pick(['panel-history', 'imp-panel-history'])];
    case 'tab': return ['tab', pick(['やること', 'スプリント', '障害物'])];
    case 'view': return ['view', pick(['盤面', '一覧', '完了', 'バーンダウン'])];
    case 'impOpen': return ['impOpen', pick(imps)];
    case 'impSave': return ['impSave', 'i' + counter.n];
    case 'impResolve': return ['impResolve', 'r' + counter.n];
    case 'pending': return ['pending', pick(['resolve', 'unresolve'])];
    default: return [name];
  }
}

function runOp(w, op) {
  return OPS[op[0]].apply(null, [w].concat(op.slice(1)));
}

/** 例外が kanban.html（画面のコード）の中で起きたか。シムやテスト側の前提崩れと見分ける。 */
function isProductError(e) {
  return !!(e && e.stack && /kanban\.html/.test(e.stack.split('\n').slice(0, 4).join('\n')));
}

/** コメント節の取得の状態: 'loading'（読み込んでいます…）/ 'failed'（読み込めませんでした）/ 'shown'。 */
function commentLoadState(w, hostId) {
  const t = W.allText(w.el(hostId));
  if (/コメントを読み込めませんでした/.test(t)) return 'failed';
  if (/コメントを読み込んでいます…/.test(t)) return 'loading';
  return 'shown';
}

/**
 * 静止後の不変条件。violations を返す（空なら合格）。
 * phase: 'quiescent'（最後の読み込みの前） / 'final'（最新にした後）
 */
function checkInvariants(w, phase, ctx) {
  const h = w.h;
  const v = [];
  const server = w.server;
  const boardShown = !w.el('board').hidden;
  const tableShown = !w.el('table-view').hidden;
  const msg = h.textOf('message');
  const tcomments = W.trueComments(server);
  const countOf = function (id) { const n = (tcomments[id] || []).length; return n ? 'コメント ' + n : null; };
  // 送信中の呼び出しが残っていないこと（静止の前提）
  if (h.calls.length) v.push('未応答の呼び出しが残っている');
  if (boardShown) {
    const tb = W.trueBoard(server);
    const sb = h.screen();
    // 列の中の並びは比べない（応答の取り込みは1枚を列の末尾へ置く作り。最新にすれば揃う）。
    const norm = function (b) { return JSON.stringify(b.map(function (c) { return { status: c.status, cards: c.cards.slice().sort() }; })); };
    if ((phase === 'final' ? JSON.stringify(tb) !== JSON.stringify(sb) : norm(tb) !== norm(sb)) && (phase === 'final' || ctx.strictBoard)) {
      v.push('盤面がサーバと違う: 画面=' + JSON.stringify(sb) + ' サーバ=' + JSON.stringify(tb));
    }
    // カードの件数
    sb.forEach(function (col) { col.cards.forEach(function (id) {
      const shown = h.cardCommentCountOf(id);
      if (shown !== countOf(id) && (phase === 'final' || ctx.strictComments)) v.push('カード ' + id + ' の件数が ' + shown + '（サーバ ' + countOf(id) + '）');
    }); });
    // タイトル
    const view = server.call('apiGetView', ['board']).view;
    view.columns.forEach(function (c) { c.cards.forEach(function (card) {
      if (sb.some(function (col) { return col.cards.indexOf(card.id) !== -1; })) {
        const t = h.cardTitleOf(card.id);
        if (t !== card.title && (phase === 'final' || ctx.strictBoard)) v.push('カード ' + card.id + ' のタイトルが ' + t + '（サーバ ' + card.title + '）');
      }
    }); });
    // pending の印が残っていないこと
    if (ctx.checkPendingMark !== false) {
      W.collect(w.el('board'), function (e) { return e.classList.contains('card'); }).forEach(function (c) {
        if (c.classList.contains('pending')) v.push('カード ' + c.dataset.id + ' に送信中の印が残っている');
      });
    }
  }
  if (tableShown) {
    const kids = h.childClassesOf('table-view');
    const txt = W.allText(w.activeTable());
    if (/読み込んでいます…/.test(txt) && phase === 'final') v.push('表が「読み込んでいます…」のまま');
    const isImp = h.tabState().tabs.some(function (t) { return t.label === '障害物' && t.selected; });
    if (isImp && !/読み込んでいます…/.test(txt) && kids.length) {
      const ti = W.trueImp(server);
      const si = w.impTable();
      if (JSON.stringify(ti) !== JSON.stringify(si) && (phase === 'final' || ctx.strictImp)) {
        v.push('障害物の表がサーバと違う: 画面=' + JSON.stringify(si) + ' サーバ=' + JSON.stringify(ti));
      }
      const counts = w.impCounts();
      ti.open.concat(ti.resolved).forEach(function (s) {
        const id = s.split(':')[0];
        const shown = counts[id] || null;
        if (shown !== countOf(id) && (phase === 'final' || ctx.strictComments)) v.push('障害物 ' + id + ' の件数が ' + shown + '（サーバ ' + countOf(id) + '）');
      });
    }
  }
  if (phase === 'final' && msg === '読み込んでいます…') v.push('全体メッセージが「読み込んでいます…」のまま');
  // 「完了する」の通知が出ているなら、サーバにその途中で止まった操作が残っていること。
  if (ctx.checkSticky && phase === 'final' && !w.el('toast').hidden && /途中で止まりました/.test(h.textOf('toast-text'))) {
    const id = h.textOf('toast-text').split(' ')[0];
    if (W.trueImp(server).pending.indexOf(id) === -1) v.push('完了済みの ' + id + ' に「完了する」の通知が残っている');
  }
  // パネル
  if (!w.el('panel').hidden) {
    const title = h.textOf('panel-title');
    if (h.disabledOf('panel-save')) v.push('PBI パネルの保存が塞がったまま');
    if (h.disabledOf('f-title')) v.push('PBI パネルの入力が塞がったまま');
    if (/^PBI-/.test(title)) {
      const ids = [].concat.apply([], W.trueBoard(server).map(function (c) { return c.cards; }));
      if (ids.indexOf(title) === -1 && phase === 'final') v.push('PBI パネルがサーバに無い ' + title + ' を開いている');
      if (!w.el('panel-comments').hidden) {
        const shown = h.commentsIn('panel-comments').map(function (c) { return c.id; });
        const truth = (tcomments[title] || []).map(function (c) { return c.id; });
        const load = commentLoadState(w, 'panel-comments');
        if (load === 'loading') v.push('PBI パネル ' + title + ' のコメントが「読み込んでいます…」のまま');
        // 取得が失敗した節は「読み込めませんでした」を出す（誤った一覧は出さない）。最新にすれば取り直す。
        if ((load !== 'failed' || phase === 'final') && JSON.stringify(shown) !== JSON.stringify(truth)
          && (phase === 'final' || ctx.strictComments)) {
          v.push('PBI パネル ' + title + ' のコメントが ' + JSON.stringify(shown) + '（サーバ ' + JSON.stringify(truth) + '）');
        }
        const f = h.commentFormOf('panel-comments');
        if (f.inputDisabled) v.push('PBI パネルのコメント入力が塞がったまま');
      }
    }
  }
  if (!w.el('imp-panel').hidden) {
    const title = h.textOf('imp-panel-title');
    if (h.disabledOf('imp-panel-resolve')) v.push('障害物パネルの解決が塞がったまま');
    if (h.disabledOf('i-title') && h.hiddenOf('i-resolution-field')) v.push('障害物パネルの入力が塞がったまま');
    if (/^IMP-/.test(title) && !w.el('imp-panel-comments').hidden) {
      const shown = h.commentsIn('imp-panel-comments').map(function (c) { return c.id; });
      const truth = (tcomments[title] || []).map(function (c) { return c.id; });
      const load = commentLoadState(w, 'imp-panel-comments');
      if (load === 'loading') v.push('障害物パネル ' + title + ' のコメントが「読み込んでいます…」のまま');
      if ((load !== 'failed' || phase === 'final') && JSON.stringify(shown) !== JSON.stringify(truth)
        && (phase === 'final' || ctx.strictComments)) {
        v.push('障害物パネル ' + title + ' のコメントが ' + JSON.stringify(shown) + '（サーバ ' + JSON.stringify(truth) + '）');
      }
      if (h.commentFormOf('imp-panel-comments').inputDisabled) v.push('障害物パネルのコメント入力が塞がったまま');
    }
  }
  ['panel-history', 'imp-panel-history'].forEach(function (host) {
    if (w.el(host).hidden || isHiddenUp(w.el(host))) return;
    const st = h.historyStateOf(host);
    if (st.expanded === 'true' && st.status === '読み込んでいます…') v.push(host + ' が「読み込んでいます…」のまま');
  });
  return v;
}

/** 静止させる: 全部処理して全部届け、タイマーを消化する（sticky の通知は残る）。 */
function quiesce(w) {
  let guard = 0;
  while (w.h.calls.length || w.h.flushTimers()) {
    if (++guard > 50) throw new Error('静止しません');
    w.drain();
  }
}

/** 1本走らせる。{ ok, ops, violations, error } を返す。 */
function runSeed(seed, cfg) {
  const rnd = W.mulberry32(seed);
  const w = W.createWorld();
  w.boot();
  if (cfg.startTab) { w.h.clickTab(cfg.startTab); w.drain(); }
  const ops = [];
  const counter = { n: 0 };
  for (let i = 0; i < cfg.steps; i++) {
    const op = pickOp(rnd, w, cfg, counter);
    let did;
    try {
      did = runOp(w, op);
    } catch (e) {
      if (isProductError(e)) return { ok: false, ops: ops.concat([op]), error: e };
      throw new Error('ファザの前提崩れ（種 ' + seed + '、操作 ' + JSON.stringify(op) + '）: ' + e.stack);
    }
    if (did) ops.push(op);
  }
  return finish(w, ops, cfg);
}

function finish(w, ops, cfg) {
  try {
    quiesce(w);
  } catch (e) {
    if (isProductError(e)) return { ok: false, ops: ops, error: e };
    throw e;
  }
  const q = checkInvariants(w, 'quiescent', cfg);
  // 最新にする（今のビューを読み直す）
  try {
    w.h.click('reload');
    quiesce(w);
  } catch (e) {
    if (isProductError(e)) return { ok: false, ops: ops, error: e };
    throw e;
  }
  const f = checkInvariants(w, 'final', cfg);
  const violations = q.map(function (s) { return '[静止] ' + s; }).concat(f.map(function (s) { return '[最新後] ' + s; }));
  return { ok: violations.length === 0, ops: ops, violations: violations, world: w };
}

/** 記録した操作列を再生する。前提が崩れた操作は飛ばす。 */
function replay(ops, cfg) {
  const w = W.createWorld();
  w.boot();
  if (cfg.startTab) { w.h.clickTab(cfg.startTab); w.drain(); }
  const done = [];
  for (const op of ops) {
    let did;
    try { did = runOp(w, op); } catch (e) {
      if (isProductError(e)) return { ok: false, ops: done.concat([op]), error: e };
      did = false;   // 前提崩れ（要素が無い等）は飛ばす
    }
    if (did) done.push(op);
  }
  return finish(w, done, cfg);
}

/** 失敗を保ったまま操作を1つずつ削る（同じ種類の違反が出続ける限り）。 */
function shrink(ops, cfg, sameFailure) {
  let cur = ops.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = cur.length - 1; i >= 0; i--) {
      const cand = cur.slice(0, i).concat(cur.slice(i + 1));
      let r;
      try { r = replay(cand, cfg); } catch (e) { continue; }
      if (!r.ok && sameFailure(r)) { cur = r.ops; changed = true; }
    }
  }
  return cur;
}

module.exports = { runSeed, replay, shrink, checkInvariants, quiesce, OPS, isProductError };
