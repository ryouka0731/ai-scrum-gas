const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * h.raw.* は「実ブラウザでは到達できない経路（hidden な要素）をあえて歩く」抜け道。
 *
 * createHarness の通常の操作手段（click / drag / clickAdd / openCard / clickTab /
 * clickView / 補足の press 等）は、対象か祖先に hidden があると例外を投げる
 * （fireVisible。display: none を再現するため）。raw.* はその手前を素通りする。
 *
 * 存在理由は、盤面が隠れているときに画面側のガード自体（activeView !== 'board' で
 * 書き込みを止める等）を検査するため。これらのガードは、シムが hidden を素通りしていた
 * 頃は「シムだけが迷い込みうる経路」を塞ぐ意味があったが、シムが hidden を尊重する今は
 * 多重の守り以上の価値はない。それでも残す判断ではあるが、raw.* という抜け道自体は
 * 放置すると「シムでは通るが実ブラウザでは成立しない検査」を新しく書く道具になりうる
 * （シムに hidden を尊重させて防ごうとした失敗の形そのもの）。
 *
 * そこで呼び出し箇所を一覧で固定する。新しく使う・使わなくなる変更は、この一覧を
 * 意図的に書き換えることになり、そこで立ち止まる（ファイル内の行がずれても壊れないよう、
 * 行番号ではなく「どのファイルの、どの test() の中か」で特定する）。
 */

const DIR = __dirname;
const RAW_CALL_RE = /\.raw\.(click|drag|clickAdd|openCard)\(/;
const TEST_NAME_RE = /^test\('((?:[^'\\]|\\.)*)'/;

/** gas/tests/*.test.js のうち、raw.* の定義側である kanban_harness.js 自身は対象外。 */
function testFiles() {
  return fs.readdirSync(DIR).filter(function (f) { return f.endsWith('.test.js'); }).sort();
}

/**
 * ファイル内の `.raw.<method>(` の出現を、直前に出た（インデントの無い）
 * `test('...', () => {` の名前と紐付けて集める。
 */
function rawCallSites() {
  const sites = [];
  testFiles().forEach(function (file) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
    let currentTest = null;
    lines.forEach(function (line) {
      const t = line.match(TEST_NAME_RE);
      if (t) currentTest = t[1];
      const m = line.match(RAW_CALL_RE);
      if (m) {
        assert.ok(currentTest, file + ': raw.' + m[1] + '(...) がどの test() の中か特定できません');
        sites.push(file + ' / ' + currentTest + ' / raw.' + m[1]);
      }
    });
  });
  return sites.sort();
}

/**
 * 今ある呼び出し箇所（6件）。すべて「盤面/隠れた要素が実ブラウザでは到達できないこと」
 * そのものを検査する意図で raw.* を使っている（Task 9 でシムが hidden を尊重するように
 * なった際、それまで通常の操作手段で書かれていた検査から切り替えた）。
 */
const ALLOWED = [
  "kanban_flow.test.js / 期限が過ぎた通知からは取り消せない / raw.click",
  "kanban_view_switch_fix1.test.js / タブ切替の読み取りが ok:false でも、選んだタブ側が表示され、隠れた盤面はドラッグしても送信されない / raw.drag",
  "kanban_view_switch_fix1.test.js / タブ切替の読み取りが通信断（withFailureHandler）でも、選んだタブ側が表示されたまま / raw.drag",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、カードの click でパネルが開かず apiUpdatePbi も飛ばない / raw.openCard",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、ドラッグしても apiUpdateStatus は飛ばない / raw.drag",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、「追加」ボタンでパネルが開かず apiCreatePbi も飛ばない / raw.clickAdd",
].sort();

test('h.raw.* の呼び出し箇所は、この一覧にある6件だけである', () => {
  assert.deepEqual(rawCallSites(), ALLOWED,
    'raw.* の呼び出し箇所が増減した。新しい箇所は「実ブラウザでは到達できない経路を'
    + 'あえて検査する」正当な理由があるかを確認したうえで、この一覧を書き換えること。');
});
