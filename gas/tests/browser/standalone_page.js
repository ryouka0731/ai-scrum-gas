'use strict';
/**
 * gas/kanban.html を、GAS 無しで実ブラウザに開ける1枚の HTML に組み立てる。
 *
 * 足すのは2つだけ:
 * 1. `doGet` が `addMetaTag` で足す viewport の meta。**文字列は web_app.js から読む**
 *    （直書きすると doGet を直したときに黙ってずれ、狭い画面の測定が実機と違うものになる）。
 * 2. `google.script.run` の代役。応答は gas/tests/browser/fixtures.js が `pure_*` から作る。
 *
 * kanban.html そのものは書き換えない（差し込むだけ）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { responses } = require('./fixtures.js');

const GAS_DIR = path.join(__dirname, '..', '..');
const KANBAN_PATH = path.join(GAS_DIR, 'kanban.html');
const WEB_APP_PATH = path.join(GAS_DIR, 'web_app.js');

/**
 * doGet が付ける viewport の内容を web_app.js から読む。
 *
 * これが取れないということは doGet が meta を付けなくなったということで、
 * その場合は実機も 980px 相当で描かれる。組み立てを黙って続けず落とす。
 */
function viewportContentFromDoGet() {
  const src = fs.readFileSync(WEB_APP_PATH, 'utf8');
  const m = src.match(/\.addMetaTag\(\s*['"]viewport['"]\s*,\s*['"]([^'"]*)['"]\s*\)/);
  if (!m) throw new Error("web_app.js の doGet が addMetaTag('viewport', ...) を呼んでいません");
  return m[1];
}

/** google.script.run の代役。__PAGE_TOKEN__ は chrome_session.open() が差し替える。 */
function stubScript(delayMs) {
  return '<script>\n'
    + '(function () {\n'
    + '  window.__pageToken = "__PAGE_TOKEN__";\n'
    + '  var RESPONSES = ' + JSON.stringify(responses()) + ';\n'
    + '  var DELAY = ' + Number(delayMs || 0) + ';\n'
    + '  window.__calls = [];\n'
    + '  window.__errors = [];\n'
    + '  window.addEventListener("error", function (e) { window.__errors.push(String(e.message)); });\n'
    + '  var WRITE = ["apiUpdateStatus", "apiCreatePbi", "apiUpdatePbi", "apiDeletePbi", "apiRestorePbi"];\n'
    + '  function makeRunner() {\n'
    + '    var ok = null, ng = null;\n'
    + '    var runner = {\n'
    + '      withSuccessHandler: function (f) { ok = f; return runner; },\n'
    + '      withFailureHandler: function (f) { ng = f; return runner; }\n'
    + '    };\n'
    + '    ["apiGetView"].concat(WRITE).forEach(function (m) {\n'
    + '      runner[m] = function () {\n'
    + '        var args = Array.prototype.slice.call(arguments);\n'
    + '        window.__calls.push({ method: m, args: args });\n'
    + '        setTimeout(function () {\n'
    + '          if (!ok) return;\n'
    + '          if (m === "apiGetView") {\n'
    + '            ok(RESPONSES[args[0]]\n'
    + '              || { ok: false, name: args[0], message: "見本がありません", view: null, summary: null });\n'
    + '          } else {\n'
    + '            ok({ ok: true, board: RESPONSES.board.view, id: null, removed: null });\n'
    + '          }\n'
    + '        }, DELAY);\n'
    + '      };\n'
    + '    });\n'
    + '    return runner;\n'
    + '  }\n'
    + '  // 本体は google.script.run を呼ぶたびに新しい runner を受け取る前提で書かれている。\n'
    + '  window.google = { script: { host: { close: function () {} } } };\n'
    + '  Object.defineProperty(window.google.script, "run", { get: makeRunner });\n'
    + '})();\n'
    + '</script>\n';
}

/**
 * 1枚の HTML を返す。
 *
 * @param {{delayMs?: number, omitViewportMeta?: boolean}} [opts]
 *   omitViewportMeta は「meta を落とすと測定が意味を失う」ことを確かめる検査だけが使う。
 */
function buildStandalonePage(opts) {
  const o = opts || {};
  let src = fs.readFileSync(KANBAN_PATH, 'utf8');

  if (!o.omitViewportMeta) {
    const meta = '<meta name="viewport" content="' + viewportContentFromDoGet() + '">';
    const charset = '<meta charset="utf-8">';
    if (src.indexOf(charset) === -1) throw new Error('kanban.html に <meta charset="utf-8"> がありません');
    src = src.replace(charset, charset + '\n' + meta);
  }

  const at = src.indexOf('<script>');
  if (at === -1) throw new Error('kanban.html に <script> がありません');
  return src.slice(0, at) + stubScript(o.delayMs) + src.slice(at);
}

module.exports = {
  buildStandalonePage: buildStandalonePage,
  viewportContentFromDoGet: viewportContentFromDoGet,
  KANBAN_PATH: KANBAN_PATH,
  WEB_APP_PATH: WEB_APP_PATH,
};
