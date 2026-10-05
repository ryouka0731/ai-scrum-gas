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
 *
 * ## この監査が捕まえる範囲（できないことを、できるかのように書かない）
 *
 * 捕まえる:
 *  - 素直な `h.raw.drag(...)`
 *  - 別名束縛（`const rr = h.raw; rr.drag(...)`）
 *  - 改行で分けた書き方（`h.raw\n  .drag(...)`）
 *  - 同じ行に収まる角括弧でのプロパティアクセス（`h['raw']` / `h[ "raw" ]` / `f()['raw']`）
 *
 * 捕まえない:
 *  - 改行をまたぐ角括弧（`h[\n  'raw'\n]`）
 *  - バッククォート（`h[\`raw\`]`）
 *  - 実行時に組み立てた名前（`h['r' + 'aw']` / `h[k]`）
 *
 * **これは「うっかり raw.* を使ったことを見えるようにする」ための監査であって、
 * 意図的な回避を止めるものではない。** 回避の書き方を正規表現で追うのは終わりがなく、
 * 追うたびに誤検出（身に覚えのない失敗 → 監査そのものを緩める動機）の危険が増える。
 * 上の書き方をわざわざ選ぶ人は偶然そう書いたのではなく、その気ならこの検査自体を
 * 消すこともできる。**範囲を広げたくなったら、まず誤検出を増やさずに済むかを見ること。**
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
// 直後に `.<method>(` が続く、いちばん素直な書き方のときだけ、落ちたときの文面に
// メソッド名を添える。**比較に使う鍵には入れない**（別名束縛・改行に書き換えると
// 総称の 'raw' になるため、鍵に入れると許可済みの箇所を書き直しただけで落ちる）。
const RAW_METHOD_RE = new RegExp(DOT_RAW + '\\.(\\w+)\\(');
// 角括弧でのプロパティアクセス（`h['raw'].drag(...)`）も同じ参照。文字列リテラルの
// 中身は後段の stripNoise が落とすため、**落とす前に** `.raw` の形へ均しておく
// （均さずに角括弧の形を探そうとすると、コメントの中の説明まで拾ってしまう）。
//
// 直前に識別子・`)`・`]` を要求する。これが無いと配列リテラル（`const a = ['raw'];`
// や `f(['raw'])`）まで `.raw` に化け、身に覚えのない箇所で監査が落ちる。
// **誤検出は見逃しより悪い** — 落ちた人が理由を推測できず、監査のほうを緩める側へ流れる。
// 空白に改行を含めない: 含めると行の対応が崩れ、test 名との紐付けがずれる。
const BRACKET_RAW_RE = /([\w)\]])\[[ \t]*(['"])raw\2[ \t]*\]/g;
function normalizeBracketAccess(text) { return text.replace(BRACKET_RAW_RE, '$1.raw'); }
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
 * 1ファイル分の `.raw` 参照を、直前に出た（インデントの無い）
 * `test('...', () => {` の名前と紐付けて集める。返すのは
 * `{ key: 'ファイル / test名', method: '表示用のメソッド名' }`。
 *
 * **比較に使う鍵は「ファイル / test名」だけ**（メソッド名は落ちたときの文面のため
 * だけに添える）。こうしておくと、.raw と呼び出しの間に何を挟まれても、未許可の
 * 箇所であれば一覧に無い「ファイル / test名」として必ず引っかかり、逆に許可済みの
 * 箇所を別名束縛や改行に書き直しただけでは落ちない。
 *
 * test 名の特定は**元のテキスト**から行う（文字列を落とすと test('...') の名前
 * そのものが読めなくなるため）。`.raw` の検出は**コメント・文字列を落としたテキスト**
 * から行う（コメントや、この一覧の文字列表現を誤検出しないため）。
 */
function rawSitesIn(file, text) {
  const sites = [];
  const originalLines = text.split('\n');
  const noiseFreeLines = stripNoise(normalizeBracketAccess(text)).split('\n');
  let currentTest = null;
  originalLines.forEach(function (line, i) {
    const t = line.match(TEST_NAME_RE);
    if (t) currentTest = t[1];
    const codeLine = noiseFreeLines[i];
    if (RAW_TOKEN_RE.test(codeLine)) {
      assert.ok(currentTest, file + ': .raw の参照がどの test() の中か特定できません');
      sites.push({
        key: file + ' / ' + currentTest,
        method: (codeLine.match(RAW_METHOD_RE) || [])[1] || 'raw',
      });
    }
  });
  return sites;
}

/** gas/tests/*.test.js 全体の呼び出し箇所（比較に使う鍵だけ）。 */
function rawCallSites() {
  return rawCallDetails().map(function (x) { return x.key; }).sort();
}

/** 同上。落ちたときの文面のために、メソッド名まで添えたもの。 */
function rawCallDetails() {
  const sites = [];
  testFiles().forEach(function (file) {
    rawSitesIn(file, fs.readFileSync(path.join(DIR, file), 'utf8')).forEach(function (x) {
      sites.push(x);
    });
  });
  return sites;
}

/**
 * 今ある呼び出し箇所（6件）。すべて「盤面/隠れた要素が実ブラウザでは到達できないこと」
 * そのものを検査する意図で raw.* を使っている（Task 9 でシムが hidden を尊重するように
 * なった際、それまで通常の操作手段で書かれていた検査から切り替えた）。
 */
const ALLOWED = [
  "kanban_flow.test.js / 期限が過ぎた通知からは取り消せない",
  "kanban_view_switch_fix1.test.js / タブ切替の読み取りが ok:false でも、選んだタブ側が表示され、隠れた盤面はドラッグしても送信されない",
  "kanban_view_switch_fix1.test.js / タブ切替の読み取りが通信断（withFailureHandler）でも、選んだタブ側が表示されたまま",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、カードの click でパネルが開かず apiUpdatePbi も飛ばない",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、ドラッグしても apiUpdateStatus は飛ばない",
  "kanban_view_switch_fix2.test.js / 盤面が隠れているとき、「追加」ボタンでパネルが開かず apiCreatePbi も飛ばない",
].sort();

test('h.raw.* の呼び出し箇所は、この一覧にある6件だけである', () => {
  const detail = rawCallDetails()
    .map(function (x) { return x.key + '（raw.' + x.method + '）'; }).sort().join('\n');
  assert.deepEqual(rawCallSites(), ALLOWED,
    'raw.* の呼び出し箇所が増減した。新しい箇所は「実ブラウザでは到達できない経路を'
    + 'あえて検査する」正当な理由があるかを確認したうえで、この一覧を書き換えること。'
    + '\n実際の箇所:\n' + detail);
});

// ---------------------------------------------------------------------------
// 走査そのものの検査（この監査が素通りしないこと）
// ---------------------------------------------------------------------------

test('角括弧でのプロパティアクセスも見つける', () => {
  // 文字列リテラルの中身は stripNoise が落とすので、均しておかないと
  // `h['raw']` はどこにも `.raw` の並びを残さず、監査を素通りする。
  const src = [
    "test('ぬけみち', () => {",
    "  h['raw'].drag('PBI-001', 'Ready');",
    '});',
  ].join('\n');
  assert.deepEqual(rawSitesIn('x.test.js', src).map(function (x) { return x.key; }),
    ['x.test.js / ぬけみち']);
});

test('角括弧はプロパティアクセスのときだけ拾う（配列リテラルで誤検出しない）', () => {
  // `['raw']` を無条件に `.raw` へ均すと、ただの配列リテラルまで呼び出し箇所として
  // 報告され、身に覚えのない失敗が出る。落ちた人は理由を推測できず、監査のほうを
  // 緩める側へ流れる（見逃しより悪い）。
  const src = [
    "test('ふつうのコード', () => {",
    "  const names = ['raw'];",
    "  f(['raw']);",
    '});',
  ].join('\n');
  assert.deepEqual(rawSitesIn('x.test.js', src), []);

  // プロパティアクセスの形は拾い続ける。
  const access = [
    "test('ぬけみち2', () => {",
    '  helpers()["raw"].drag();',
    '});',
  ].join('\n');
  assert.deepEqual(rawSitesIn('x.test.js', access).map(function (x) { return x.key; }),
    ['x.test.js / ぬけみち2']);
});

test('許可済みの箇所を書き直しても、比較に使う鍵は変わらない', () => {
  // 別名束縛・改行に書き換えるとメソッド名は総称の 'raw' になる。鍵にメソッド名まで
  // 入れると、振る舞いを変えていないのにこの監査が落ちる（コメントの約束と食い違う）。
  const plain = "test('ある検査', () => {\n  h.raw.drag('PBI-001', 'Ready');\n});";
  const alias = "test('ある検査', () => {\n  const rr = h.raw;\n  rr.drag('PBI-001', 'Ready');\n});";
  const wrapped = "test('ある検査', () => {\n  h.raw\n    .drag('PBI-001', 'Ready');\n});";
  const keys = function (src) { return rawSitesIn('x.test.js', src).map(function (x) { return x.key; }); };
  assert.deepEqual(keys(plain), ['x.test.js / ある検査']);
  assert.deepEqual(keys(alias), keys(plain));
  assert.deepEqual(keys(wrapped), keys(plain));
});

test('コメントや文字列の中の .raw は拾わない', () => {
  const src = [
    "test('ある検査', () => {",
    '  // h.raw.drag をここでは使わない',
    "  const label = 'h.raw.drag';",
    '});',
  ].join('\n');
  assert.deepEqual(rawSitesIn('x.test.js', src), []);
});
