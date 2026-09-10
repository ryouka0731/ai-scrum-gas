'use strict';
// kanban.html の <script> を node:vm 上で走らせるための最小 DOM シム。
//
// 要点は「サーバでの処理順」と「ブラウザへの到達順」を別々に決められること。
// google.script.run は呼び出しをキューに積むだけにし、テスト側が任意の順で
// handlers.success / handlers.failure を呼ぶ。これが無いと到達順の検査は成立しない。
//
// 判定は内部変数ではなく、描画された DOM から読む（screen() / textOf() 等）。
// ただしシムは CSS を評価しないため、display の打ち消しのような欠陥は原理的に
// 検出できない。その種の検査は styleRules() を使った静的検査で行う。
//
// setTimeout は溜めるだけにし、flushTimers() で明示的に進める（通知の自動消滅を
// 実時間を待たずに検査するため）。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, '..', 'kanban.html');

// 36通りの組み合わせ検査では createHarness を何度も呼ぶため、読み込みは1回にする。
let htmlCache = null;
function html() {
  if (htmlCache === null) htmlCache = fs.readFileSync(HTML_PATH, 'utf8');
  return htmlCache;
}

/** kanban.html の <script> の中身を返す。 */
function scriptSource() {
  const m = html().match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('kanban.html に <script> が見つかりません');
  return m[1];
}

/** kanban.html の <style> の中身を返す。 */
function styleSource() {
  const m = html().match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('kanban.html に <style> が見つかりません');
  return m[1];
}

/**
 * CSS を最上位の規則へ切り分ける。@media 等の入れ子は1件の規則として扱い、
 * 中身は body に残す（＝入れ子の中の規則は最上位としては返さない）。
 */
function topLevelRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let buf = '';
  let selector = '';
  let depth = 0;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') {
      depth++;
      if (depth === 1) { selector = buf.trim(); buf = ''; continue; }
    } else if (ch === '}') {
      depth--;
      if (depth === 0) { rules.push({ selector: selector, body: buf }); buf = ''; continue; }
    }
    buf += ch;
  }
  return rules;
}

/** kanban.html の <style> の最上位規則を返す。 */
function styleRules() {
  return topLevelRules(styleSource());
}

/** セレクタ列をカンマで分けて trim した配列を返す。 */
function selectorList(selector) {
  return selector.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

/** 宣言ブロックを [{ property, value }] に分ける。 */
function declarations(body) {
  return body.split(';').map(function (d) {
    const at = d.indexOf(':');
    if (at === -1) return null;
    return { property: d.slice(0, at).trim().toLowerCase(), value: d.slice(at + 1).trim() };
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// DOM シム
// ---------------------------------------------------------------------------

function Element(tagName) {
  this.tagName = tagName;
  this.children = [];
  this.parentNode = null;
  this.attributes = {};
  this.dataset = {};
  this.style = {};
  this.listeners = {};
  this.className = '';
  this.textContent = '';
  this.hidden = false;
  this.disabled = false;
  this.value = '';
  this.draggable = false;
  this.onclick = null;
  this.focusCount = 0;
  const self = this;
  const names = function () {
    return self.className ? self.className.split(/\s+/).filter(Boolean) : [];
  };
  this.classList = {
    add: function (c) {
      const l = names();
      if (l.indexOf(c) === -1) { l.push(c); self.className = l.join(' '); }
    },
    remove: function (c) {
      self.className = names().filter(function (x) { return x !== c; }).join(' ');
    },
    contains: function (c) { return names().indexOf(c) !== -1; }
  };
}

Object.defineProperty(Element.prototype, 'innerHTML', {
  get: function () { return ''; },
  set: function (v) {
    // 契約: 空文字の代入だけを許す。文字列で DOM を組み立てるコードが混ざったら気づけるようにする。
    if (v !== '') throw new Error('innerHTML への非空文字の代入は許可していません: ' + v);
    this.children.forEach(function (c) { c.parentNode = null; });
    this.children = [];
  }
});

/**
 * <select> の value は実ブラウザでは「.value に代入した値と一致する <option> が無ければ
 * selectedIndex が -1 になり、.value は空文字を返す」という挙動を持つ。
 * priority のように CSV の既存値が語彙外のことがある select でこれを再現しないと、
 * 「パネルが空欄で表示している値」と「差分送信の基準値」がずれる欠陥をシムが検出できない。
 */
Object.defineProperty(Element.prototype, 'value', {
  get: function () { return this._value === undefined ? '' : this._value; },
  set: function (v) {
    v = String(v);
    if (this.tagName === 'select') {
      var hasMatch = this.children.some(function (o) { return o.tagName === 'option' && o.value === v; });
      this._value = hasMatch ? v : '';
    } else {
      this._value = v;
    }
  }
});

Element.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};
Element.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
Element.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};
Element.prototype.addEventListener = function (type, fn) {
  (this.listeners[type] || (this.listeners[type] = [])).push(fn);
};
Element.prototype.focus = function () { this.focusCount++; };

/** 要素に type のイベントを起こす。click は onclick も呼ぶ（実ブラウザと同じ）。 */
function fire(el, type, ev) {
  const list = (el.listeners[type] || []).slice();
  list.forEach(function (fn) { fn.call(el, ev || {}); });
  if (type === 'click' && typeof el.onclick === 'function') el.onclick.call(el, ev || {});
}

/** el を根に、条件に合う要素を深さ優先で集める。 */
function collect(el, pred, out) {
  out = out || [];
  el.children.forEach(function (c) {
    if (pred(c)) out.push(c);
    collect(c, pred, out);
  });
  return out;
}

/**
 * <body> にある id 付きの要素を作る。HTML 側に id を足したらシムにも自動で載る。
 * <script> 以降は走査しない（JS 本文をタグとして誤認しないため）。
 */
function buildStaticElements() {
  const source = html();
  const from = source.indexOf('<body>');
  const to = source.indexOf('<script>');
  if (from === -1 || to === -1 || to < from) throw new Error('kanban.html の <body> を切り出せません');
  const body = source.slice(from, to);
  const byId = {};
  const re = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const attrs = m[2];
    const idm = attrs.match(/\bid="([^"]+)"/);
    if (!idm) continue;
    const el = new Element(m[1].toLowerCase());
    // aria-hidden を hidden 属性と取り違えないよう、直前が空白のものだけを見る。
    el.hidden = /\shidden(\s|=|$)/.test(attrs);
    byId[idm[1]] = el;
  }
  return byId;
}

// ---------------------------------------------------------------------------
// google.script.run のシム
// ---------------------------------------------------------------------------

// 実装が呼ぶサーバ側 API。ここに無い名前を呼ぶと TypeError になり、取りこぼしに気づける。
const API_METHODS = [
  'apiGetView', 'apiUpdateStatus', 'apiUpdatePbi',
  'apiCreatePbi', 'apiDeletePbi', 'apiRestorePbi'
];

/** 呼び出しをキューに積むだけの google.script.run を作る。 */
function makeGoogle(calls) {
  function newRunner() {
    const bound = { success: null, failure: null };
    const runner = {
      withSuccessHandler: function (fn) { bound.success = fn; return runner; },
      withFailureHandler: function (fn) { bound.failure = fn; return runner; }
    };
    API_METHODS.forEach(function (name) {
      runner[name] = function () {
        const args = Array.prototype.slice.call(arguments);
        const call = { method: name, args: args, handlers: {} };
        const settle = function (kind, value) {
          const at = calls.indexOf(call);
          if (at === -1) throw new Error(name + ' の応答を二重に届けています');
          calls.splice(at, 1);   // calls は「未応答の呼び出し」
          const fn = bound[kind];
          if (typeof fn !== 'function') throw new Error(name + ' に ' + kind + ' ハンドラがありません');
          fn(value);
        };
        call.handlers.success = function (res) { settle('success', res); };
        call.handlers.failure = function (err) { settle('failure', err); };
        calls.push(call);
        return null;
      };
    });
    return runner;
  }
  const script = {};
  // google.script.run は参照するたびに新しい runner を返す。
  Object.defineProperty(script, 'run', { get: newRunner, enumerable: true });
  return { script: script };
}

// ---------------------------------------------------------------------------
// ハーネス
// ---------------------------------------------------------------------------

/** [{status, cards:[card]}] を深く複製する。 */
function cloneColumns(cols) {
  return cols.map(function (c) {
    return {
      status: c.status,
      cards: c.cards.map(function (card) {
        return (typeof card === 'string') ? card : Object.assign({}, card);
      })
    };
  });
}

/**
 * kanban.html の <script> を載せたハーネスを作る。
 * 評価は sandbox.load() の初回呼び出しまで遅らせる（<script> 末尾の loadView() が
 * そのまま初期読み込みになるため、apiGetView がちょうど1件積まれる）。
 */
function createHarness(initialColumns) {
  const byId = buildStaticElements();
  const calls = [];
  let timerSeq = 0;
  const timers = {};

  const document = {
    listeners: {},
    getElementById: function (id) {
      return Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null;
    },
    createElement: function (tag) { return new Element(String(tag).toLowerCase()); },
    createElementNS: function (ns, tag) {
      const el = new Element(String(tag).toLowerCase());
      el.namespaceURI = ns;
      return el;
    },
    addEventListener: function (type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    }
  };

  const sandbox = {
    document: document,
    google: makeGoogle(calls),
    setTimeout: function (fn, ms) {
      timerSeq++;
      timers[timerSeq] = { fn: fn, ms: ms };
      return timerSeq;
    },
    clearTimeout: function (id) { delete timers[id]; }
  };
  let evaluated = false;
  // kanban.html の <script> はもう load という名前の関数を宣言していない
  // （末尾が renderTabs(); showView(activeView); loadView(); になっている）。
  // このラッパーはハーネス側だけの入り口で、<script> の評価を初回呼び出しまで
  // 遅らせるためのもの（末尾の loadView() がそのまま初期読み込みになり、
  // apiGetView がちょうど1件積まれる）。
  sandbox.load = function () {
    if (evaluated) throw new Error('sandbox.load() を2回呼んでいます（<script> の評価は1回だけです）');
    evaluated = true;
    vm.runInContext(scriptSource(), sandbox, { filename: 'kanban.html' });
  };
  vm.createContext(sandbox);

  /** #board の中から条件に合う要素を集める。 */
  const inBoard = function (pred) { return collect(byId.board, pred); };
  const cardElements = function () {
    return inBoard(function (el) { return el.classList.contains('card'); });
  };
  const cardElement = function (id) {
    const hit = cardElements().filter(function (el) { return el.dataset.id === id; });
    if (hit.length !== 1) throw new Error('カード ' + id + ' が ' + hit.length + ' 件見つかりました');
    return hit[0];
  };
  const el = function (id) {
    const found = document.getElementById(id);
    if (!found) throw new Error('要素 ' + id + ' がありません');
    return found;
  };

  return {
    sandbox: sandbox,
    calls: calls,

    /** 描画済み DOM から [{status, cards:[id]}] を読む。 */
    screen: function () {
      return byId.board.children.map(function (col) {
        return {
          status: col.dataset.status,
          cards: collect(col, function (e) { return e.classList.contains('card'); })
            .map(function (c) { return c.dataset.id; })
        };
      });
    },

    /** 実ハンドラ経由で dragstart → dragover → drop → dragend を起こす。 */
    drag: function (id, toStatus) {
      const card = cardElement(id);
      const zones = inBoard(function (e) {
        return e.classList.contains('dropzone') && e.dataset.status === toStatus;
      });
      if (zones.length !== 1) throw new Error('列 ' + toStatus + ' が ' + zones.length + ' 件見つかりました');
      const data = {};
      const dataTransfer = {
        setData: function (k, v) { data[k] = String(v); },
        getData: function (k) { return data[k] || ''; }
      };
      const noop = function () {};
      fire(card, 'dragstart', { dataTransfer: dataTransfer, preventDefault: noop });
      fire(zones[0], 'dragover', { preventDefault: noop });
      fire(zones[0], 'drop', { preventDefault: noop });
      fire(card, 'dragend', {});
    },

    /** 静的な要素の click を起こす。disabled なら実ブラウザ同様に何も起きない。 */
    click: function (elementId) {
      const target = el(elementId);
      if (target.disabled) return;
      fire(target, 'click', {});
    },

    /** その列の「追加」ボタンを押す。 */
    clickAdd: function (status) {
      const cols = byId.board.children.filter(function (c) { return c.dataset.status === status; });
      if (cols.length !== 1) throw new Error('列 ' + status + ' が ' + cols.length + ' 件見つかりました');
      const adds = collect(cols[0], function (e) { return e.classList.contains('add'); });
      if (adds.length !== 1) throw new Error('列 ' + status + ' の追加ボタンが見つかりません');
      fire(adds[0], 'click', {});
    },

    /** 描画済みカードの click を起こす。 */
    openCard: function (id) { fire(cardElement(id), 'click', {}); },

    /** 描画済みカードのタイトルを DOM から読む（内部変数ではなく画面を見るため）。 */
    cardTitleOf: function (id) {
      const hit = collect(cardElement(id), function (e) { return e.classList.contains('title'); });
      if (hit.length !== 1) throw new Error('カード ' + id + ' のタイトルが ' + hit.length + ' 件見つかりました');
      return hit[0].textContent;
    },

    /** 溜まっている setTimeout をすべて発火させる（時間経過を進める）。 */
    flushTimers: function () {
      const ids = Object.keys(timers).map(Number).sort(function (a, b) { return a - b; });
      const due = ids.map(function (id) { const t = timers[id]; delete timers[id]; return t; });
      due.forEach(function (t) { t.fn(); });
      return due.length;
    },

    /** document の keydown を起こす（Escape 等）。 */
    pressKey: function (key) {
      (document.listeners.keydown || []).slice().forEach(function (fn) { fn({ key: key }); });
    },

    setValue: function (fieldId, value) { el(fieldId).value = value; },
    valueOf: function (fieldId) { return el(fieldId).value; },
    hiddenOf: function (id) { return !!el(id).hidden; },
    disabledOf: function (id) { return !!el(id).disabled; },
    textOf: function (id) { return el(id).textContent; },

    /** [{status, cards:[{id,...}]}] から応答用の {columns:[...]} を作る。 */
    boardOf: function (cols) {
      return { columns: cloneColumns(cols || initialColumns) };
    },

    /** 同じものを screen() と比べられる [{status, cards:[id]}] に潰す。 */
    columnsOf: function (cols) {
      return (cols || initialColumns).map(function (c) {
        return {
          status: c.status,
          cards: c.cards.map(function (card) { return (typeof card === 'string') ? card : card.id; })
        };
      });
    },

    /** #tabs の中から、そのラベルのタブボタンの click を起こす。 */
    clickTab: function (label) {
      const hit = byId.tabs.children.filter(function (b) { return b.textContent === label; });
      if (hit.length !== 1) throw new Error('タブ「' + label + '」が ' + hit.length + ' 件見つかりました');
      fire(hit[0], 'click', {});
    },

    /** #views の中から、そのラベルのビューボタンの click を起こす。 */
    clickView: function (label) {
      const hit = byId.views.children.filter(function (b) { return b.textContent === label; });
      if (hit.length !== 1) throw new Error('ビュー「' + label + '」が ' + hit.length + ' 件見つかりました');
      fire(hit[0], 'click', {});
    },

    /** #tabs / #views のボタンのラベルと選択状態（aria-selected）を DOM から読む。 */
    tabState: function () {
      const state = function (container) {
        return container.children.map(function (b) {
          return { label: b.textContent, selected: b.getAttribute('aria-selected') === 'true' };
        });
      };
      return { tabs: state(byId.tabs), views: state(byId.views), viewsHidden: !!byId.views.hidden };
    },

    /** id の要素の下にある table の tbody を [[{text, marked}]] で読む（表が無ければ null）。 */
    tableRowsOf: function (hostId) {
      const host = el(hostId);
      const tables = collect(host, function (e) { return e.tagName === 'table'; });
      if (tables.length === 0) return null;
      const tbody = collect(tables[0], function (e) { return e.tagName === 'tbody'; })[0];
      if (!tbody) return [];
      return tbody.children.map(function (tr) {
        return tr.children.map(function (td) {
          return { text: td.textContent, marked: td.classList.contains('mark') };
        });
      });
    },

    /** その要素のタグ名を読む（input と select の取り違えを見分けるため）。 */
    tagOf: function (id) { return el(id).tagName; },

    /** <select> の選択肢を [{value, label}] で読む（描画順のまま）。 */
    optionsOf: function (fieldId) {
      return el(fieldId).children
        .filter(function (o) { return o.tagName === 'option'; })
        .map(function (o) { return { value: o.value, label: o.textContent }; });
    },

    /**
     * hostId の下にある補足（.help）を、操作できる形で返す。
     *
     * 用語は ? ボタンの aria-label（「<用語>とは」）から読む。内部変数ではなく
     * 画面から辿るため。用語集に無い語では makeHelp が空の .help を返すので、
     * ボタンを持たないものは「補足が出ていない」として除く。
     */
    helpsIn: function (hostId) {
      return collect(el(hostId), function (e) { return e.classList.contains('help'); })
        .map(function (wrap) {
          const btn = wrap.children.filter(function (c) { return c.tagName === 'button'; })[0];
          const body = wrap.children.filter(function (c) { return c.classList.contains('help-body'); })[0];
          if (!btn || !body) return null;
          return {
            term: String(btn.getAttribute('aria-label') || '').replace(/とは$/, ''),
            press: function () { fire(btn, 'click', {}); },
            /**
             * タッチ端末での1回のタップ。ブラウザが出す順に起こす:
             * pointerdown が先、そのあとに互換のための mouseenter と focus、最後に click。
             */
            tap: function () {
              fire(btn, 'pointerdown', {});
              fire(btn, 'mouseenter', {});
              fire(btn, 'focus', {});
              fire(btn, 'click', {});
            },
            /**
             * マウスでの1回のクリック。カーソルが乗るのが先で、pointerdown はその後。
             */
            mouseClick: function () {
              fire(btn, 'mouseenter', {});
              fire(btn, 'pointerdown', {});
              fire(btn, 'click', {});
            },
            hover: function () { fire(btn, 'mouseenter', {}); },
            leave: function () { fire(wrap, 'mouseleave', {}); },
            focus: function () { fire(btn, 'focus', {}); },
            blur: function () { fire(btn, 'blur', {}); },
            isOpen: function () { return !body.hidden; },
            expanded: function () { return btn.getAttribute('aria-expanded'); },
            text: function () { return body.textContent; }
          };
        })
        .filter(Boolean);
    },

    /** hostId の下にある、その用語の補足をひとつ返す（無ければ例外）。 */
    helpFor: function (hostId, term) {
      const hit = this.helpsIn(hostId).filter(function (h) { return h.term === term; });
      if (hit.length !== 1) throw new Error('補足「' + term + '」が ' + hit.length + ' 件見つかりました');
      return hit[0];
    },

    /** id の要素の下にあるテキストをすべて（DOM 順に空白区切りで）連結して読む。 */
    textTreeOf: function (hostId) {
      const texts = [];
      (function walk(e) {
        if (e.textContent) texts.push(e.textContent);
        e.children.forEach(walk);
      })(el(hostId));
      return texts.join(' ');
    }
  };
}

module.exports = {
  createHarness: createHarness,
  htmlSource: html,
  styleRules: styleRules,
  selectorList: selectorList,
  declarations: declarations,
  topLevelRules: topLevelRules,
  styleSource: styleSource,
  scriptSource: scriptSource
};
