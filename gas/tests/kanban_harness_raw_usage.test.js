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
// `.raw.click(` のような「メソッドまで一致」する形にすると、`const rr = h.raw;
// rr.openCard(...)` や `h.raw\n  .openCard(...)` のような、.raw と呼び出しの間に
// 別名束縛・改行を挟む書き方で素通りする（実測: レビューで確認された抜け道）。
// `.raw` という参照そのもの（プロパティアクセス）は、これらの書き方でも必ず
// リテラルに残る一方、raw.* を使わない通常のコードには現れない。ここだけを拾う。
const RAW_TOKEN_RE = /\.raw\b/;
// 直後に `.<method>(` が続く、いちばん素直な書き方のときだけ、一覧を読みやすくする
// ためにメソッド名を添える。別名束縛・改行のときは 'raw'（総称）のままにする —
// それによって一覧の該当箇所（file / test）が変わらない限り、抜け道側の書き方を
// 凝らしても検出（後述の deepEqual）には影響しない。
const RAW_METHOD_RE = /\.raw\.(\w+)\(/;
const TEST_NAME_RE = /^test\('((?:[^'\\]|\\.)*)'/;

// raw.* の定義側である kanban_harness.js と、この検査自身（説明の中に `.raw` という
// 文字列そのものを書いているため、自分を対象に含めると自分の説明文を拾って誤検出する）
// は対象外。
const SELF = path.basename(__filename);
/** gas/tests/*.test.js のうち、上記2ファイルを除いたもの。 */
function testFiles() {
  return fs.readdirSync(DIR)
    .filter(function (f) { return f.endsWith('.test.js') && f !== SELF; })
    .sort();
}

/**
 * ファイル内の `.raw` 参照の出現を、直前に出た（インデントの無い）
 * `test('...', () => {` の名前と紐付けて集める。比較に使う鍵は「ファイル / test名」
 * だけ（メソッド名は表示用の飾り）なので、.raw と呼び出しの間に何を挟まれても、
 * 未許可の箇所であればこの一覧に無い「ファイル / test名」として必ず引っかかる。
 */
function rawCallSites() {
  const sites = [];
  testFiles().forEach(function (file) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n');
    let currentTest = null;
    lines.forEach(function (line) {
      const t = line.match(TEST_NAME_RE);
      if (t) currentTest = t[1];
      if (RAW_TOKEN_RE.test(line)) {
        assert.ok(currentTest, file + ': .raw の参照がどの test() の中か特定できません');
        const method = (line.match(RAW_METHOD_RE) || [])[1] || 'raw';
        sites.push(file + ' / ' + currentTest + ' / raw.' + method);
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
