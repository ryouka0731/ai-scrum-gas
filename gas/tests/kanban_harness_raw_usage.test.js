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

// 検出したい文字列を、この定義の行自体には残らない形で組み立てる。文字列断片を
// + で継ぐことで、この行のソーステキストには「.raw」という連続した文字が現れない
// （素朴に /\.raw\b/ と書くと、この検査自身をスキャン対象に含めたときに、この
// 定義そのものが自分の探している対象として引っかかってしまう。コメントや文字列は
// 後述のとおり事前に落とすが、正規表現リテラルはコード自体なので落とせない）。
const DOT_RAW = '\\' + '.' + 'raw';
// `.raw.click(` のような「メソッドまで一致」する形にすると、`const rr = h.raw;
// rr.openCard(...)` や `h.raw\n  .openCard(...)` のような、.raw と呼び出しの間に
// 別名束縛・改行を挟む書き方で素通りする（実測: レビューで確認された抜け道）。
// `.raw` という参照そのもの（プロパティアクセス）は、これらの書き方でも必ず
// リテラルに残る一方、raw.* を使わない通常のコードには現れない。ここだけを拾う。
const RAW_TOKEN_RE = new RegExp(DOT_RAW + '\\b');
// 直後に `.<method>(` が続く、いちばん素直な書き方のときだけ、一覧を読みやすくする
// ためにメソッド名を添える。別名束縛・改行のときは 'raw'（総称）のままにする —
// それによって一覧の該当箇所（file / test）が変わらない限り、抜け道側の書き方を
// 凝らしても検出（後述の deepEqual）には影響しない。
const RAW_METHOD_RE = new RegExp(DOT_RAW + '\\.(\\w+)\\(');
const TEST_NAME_RE = /^test\('((?:[^'\\]|\\.)*)'/;

/**
 * 行コメント・ブロックコメント・文字列リテラル（シングルクォート／ダブルクォート）の
 * 中身を空白に落とす。改行だけは残す（行番号がずれると TEST_NAME_RE との対応が崩れる）。
 *
 * これが無いと、raw の使い方を説明する**コメント**（例: 「通常の操作では h の
 * raw 経由の呼び出しを使わないこと」）や、この一覧の文字列（"raw.click" 等）まで
 * 拾ってしまう。特にコメントは、直前に出た test() の名前に誤って帰属する
 * （実在しない呼び出し箇所が一覧に現れる）ため、実害が大きい。
 *
 * バッククォート（テンプレートリテラル）は対象にしない。この一帯の .test.js は
 * コード側で使っていない（コメント中の説明でだけ使う。実際にこのファイルでも、
 * バッククォートを本物の文字列開始と誤認して、遠く離れた別のバッククォートまで
 * 一続きの文字列として飲み込む形で踏んだ）。バッククォートが実コードとして
 * 使われる変更が入るまでは、対象を外して自己参照の危うさを避ける。
 *
 * **この判断の帰結**: バッククォート文字列は落としていないので、誰かが
 * テンプレート文字列を書き、その中身に `.raw` が含まれると誤検出する
 * （身に覚えのない箇所が一覧に現れて raw_usage が落ちる）。安全側の誤検出
 * （見逃しではない）なので実害は小さいが、そのとき落ちた人が理由を推測できないと
 * 一覧を緩める方向へ流れる。**そのときは一覧を緩めるのではなく、この走査
 * （NOISE_RE にバッククォートの対応を足す）を直すこと。**
 *
 * 注意: このコメント自身の中に、ブロックコメントの開始・終了を表す記号の並びを
 * そのまま書かないこと。非貪欲マッチでも、最初に現れたその並びで閉じたと
 * 誤認して以降の走査が崩れる（このファイルで実際に踏んだ）。
 */
function stripNoise(text) {
  const NOISE_RE = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
  return text.replace(NOISE_RE, function (m) { return m.replace(/[^\n]/g, ' '); });
}

/** gas/tests/*.test.js すべて。この検査自身（このファイル）も除外しない。 */
function testFiles() {
  return fs.readdirSync(DIR).filter(function (f) { return f.endsWith('.test.js'); }).sort();
}

/**
 * ファイル内の `.raw` 参照の出現を、直前に出た（インデントの無い）
 * `test('...', () => {` の名前と紐付けて集める。比較に使う鍵は「ファイル / test名」
 * だけ（メソッド名は表示用の飾り）なので、.raw と呼び出しの間に何を挟まれても、
 * 未許可の箇所であればこの一覧に無い「ファイル / test名」として必ず引っかかる。
 *
 * test 名の特定は**元のテキスト**から行う（文字列を落とすと test('...') の名前
 * そのものが読めなくなるため）。`.raw` の検出は**コメント・文字列を落としたテキスト**
 * から行う（コメントや、この一覧の文字列表現を誤検出しないため）。
 */
function rawCallSites() {
  const sites = [];
  testFiles().forEach(function (file) {
    const original = fs.readFileSync(path.join(DIR, file), 'utf8');
    const originalLines = original.split('\n');
    const noiseFreeLines = stripNoise(original).split('\n');
    let currentTest = null;
    originalLines.forEach(function (line, i) {
      const t = line.match(TEST_NAME_RE);
      if (t) currentTest = t[1];
      const codeLine = noiseFreeLines[i];
      if (RAW_TOKEN_RE.test(codeLine)) {
        assert.ok(currentTest, file + ': .raw の参照がどの test() の中か特定できません');
        const method = (codeLine.match(RAW_METHOD_RE) || [])[1] || 'raw';
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
