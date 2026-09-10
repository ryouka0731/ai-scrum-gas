'use strict';
/**
 * 実ブラウザ（Chrome の headless）を CDP で操るための最小の道具。
 *
 * 依存パッケージは足さない。Node 22 の組み込み WebSocket と fetch だけで話す
 * （puppeteer / playwright を入れると、この検査のために本体の配布物が増える）。
 *
 * ## 「黙って別のものを測る」ことを構造で防ぐ
 *
 * この種の測定で一番悪いのは、失敗ではなく**別のものを測って成功すること**。
 * チームリードの試作は実際に「1440px を測ったつもりが 375px の値だった」を踏んでいる
 * （ポートと --user-data-dir が固定で、前の実行の Chrome がまだ生きていたため、
 * 新しい Chrome は既存プロファイルを見つけて自分は終了し、CDP は古いページを返した）。
 * ここでは前提をひとつずつ実測して突き合わせる:
 *
 * 1. Chrome は実行ごとに使い捨てる（空きポートを取り、--user-data-dir は毎回 mkdtemp）。
 * 2. 開くページは毎回**別のファイル**（token 入りのファイル名）にし、ページ内の
 *    `window.__pageToken` が要求した token と一致することを確かめる。
 *    → 古いページを掴んでいたら必ずここで落ちる。
 * 3. `documentElement.clientWidth` が指定した幅と一致することを確かめる。
 *    → 幅の指定が効いていなければ落ちる（viewport meta の入れ忘れもここで出る）。
 * 4. `matchMedia('(prefers-color-scheme: dark)')` が指定した配色と一致することを確かめる。
 *    → 配色の指定が効いていなければ落ちる。
 *
 * どれも一致しなければ **測定を失敗として扱う**（黙って進めない）。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

/**
 * Chrome の在り処。CHROME_PATH があればそれだけを見る（指定したのに別の
 * ブラウザで測るほうが分かりにくい）。見つからなければ null。
 */
const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

function chromePath() {
  if (process.env.CHROME_PATH) {
    return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  }
  return CANDIDATES.filter(function (p) { return fs.existsSync(p); })[0] || null;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/** 空きポートを1つ取る。固定ポートにすると前の実行の Chrome に繋いでしまう。 */
function freePort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      const port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

let tokenSeq = 0;
/** ページごとに一意な合言葉。古いページを掴んでいないことの確認に使う。 */
function nextToken() {
  tokenSeq++;
  return process.pid + '-' + Date.now().toString(36) + '-' + tokenSeq;
}

/** CDP の要求/応答を id で対応付ける。 */
function cdpClient(ws) {
  let id = 0;
  const waiting = new Map();
  let closed = null;
  ws.addEventListener('message', function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && waiting.has(msg.id)) {
      const w = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error('CDP ' + w.method + ': ' + JSON.stringify(msg.error)));
      else w.resolve(msg.result);
    }
  });
  ws.addEventListener('close', function () {
    closed = new Error('CDP の接続が閉じました');
    waiting.forEach(function (w) { w.reject(closed); });
    waiting.clear();
  });
  return function send(method, params) {
    if (closed) return Promise.reject(closed);
    const mid = ++id;
    return new Promise(function (resolve, reject) {
      waiting.set(mid, { resolve: resolve, reject: reject, method: method });
      ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
    });
  };
}

/**
 * Chrome を1つ起こして CDP に繋ぐ。返る session は使い終わったら close() する。
 *
 * @param {{timeoutMs?: number}} [opts]
 */
async function launch(opts) {
  const bin = chromePath();
  if (!bin) throw new Error('Chrome が見つかりません（CHROME_PATH で指定できます）');
  const timeoutMs = (opts && opts.timeoutMs) || 20000;

  const port = await freePort();
  // 実行ごとに使い捨てる。使い回すと、前の実行の Chrome が生き残っていたときに
  // 新しい Chrome が「既に起きている」と判断して自分は終了し、CDP は古いページを返す。
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-scrum-gas-chrome-'));
  const pageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-scrum-gas-page-'));

  const proc = spawn(bin, [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + userDataDir,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-gpu', '--force-device-scale-factor=1',
    // headless でも背景タブ扱いでタイマーが間引かれると、google.script.run の
    // 代役（setTimeout で応答する）が遅れて「応答が来ない」に見える。
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ], { stdio: 'ignore' });

  let exited = null;
  proc.on('exit', function (code) { exited = code; });

  const cleanup = function () {
    try { proc.kill('SIGKILL'); } catch (_) { /* 既に終わっている */ }
    // SIGKILL は非同期に届く。直後の削除は Chrome がまだ書いている最中に当たるため、
    // 数回まで待って消し直す（消し残すと、次の実行がそれを見つけて紛らわしい）。
    const rm = function (dir) {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); } catch (_) {}
    };
    rm(userDataDir);
    rm(pageDir);
  };
  // close() を呼べずに終わる道（before フックが落ちる等）でも Chrome と一時ディレクトリを
  // 残さない。残った Chrome は次の実行に紛れ込みうるので、確実に始末する。
  process.once('exit', cleanup);

  // CDP のポートが開くのを待つ。ここで拾う target は「今起こした Chrome」のもの
  // でなければならないので、繋いだあとにもページの合言葉で必ず確かめる。
  let wsUrl = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) { cleanup(); throw new Error('Chrome が起動直後に終了しました（code=' + exited + '）'); }
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = list.filter(function (t) { return t.type === 'page' && t.webSocketDebuggerUrl; })[0];
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch (_) { /* まだ起きていない */ }
    await sleep(100);
  }
  if (!wsUrl) { cleanup(); throw new Error('Chrome の CDP に ' + timeoutMs + 'ms 以内に繋がりませんでした'); }

  const ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', function () { reject(new Error('CDP の WebSocket に繋がりません')); }, { once: true });
  });
  const send = cdpClient(ws);
  await send('Page.enable');
  await send('Runtime.enable');

  /** ページ内で式を評価する（Promise を返す式は解決を待つ）。 */
  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', {
      expression: '(function(){' + expression + '})()',
      returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('ページ内で例外: ' + ((d.exception && d.exception.description) || d.text));
    }
    return r.result.value;
  }

  /** 条件が満たされるまで待つ。満たされないまま期限が来たら落とす（黙って進めない）。 */
  async function waitFor(expression, label, waitMs) {
    const limit = waitMs || 10000;
    const until = Date.now() + limit;
    let last = null;
    while (Date.now() < until) {
      last = await evaluate(expression);
      if (last) return last;
      await sleep(50);
    }
    throw new Error(label + ' が ' + limit + 'ms 以内に成立しませんでした（最後の値: ' + JSON.stringify(last) + '）');
  }

  /**
   * ページを開く。開いたあとに「指定した幅・配色・そのページ自身か」を実測で確かめ、
   * 食い違えば落とす。
   *
   * @param {{html: string, width: number, height: number, scheme: 'light'|'dark'}} spec
   * @returns {Promise<{token: string, viewport: object}>}
   */
  async function open(spec) {
    const token = nextToken();
    // 毎回ファイル名を変える。同じ URL を開き直すより、別の URL を開くほうが
    // 「今見ているのがどの文書か」を取り違えようがない。
    const file = path.join(pageDir, 'page-' + token + '.html');
    fs.writeFileSync(file, spec.html.replace(/__PAGE_TOKEN__/g, token), 'utf8');

    await send('Emulation.setDeviceMetricsOverride', {
      width: spec.width, height: spec.height,
      deviceScaleFactor: 1,
      // mobile: true にすると Chrome は viewport meta を実機と同じように解釈する。
      // meta が無ければ 980px 相当で描かれるので、「meta の再現を忘れた」が
      // 幅の照合でそのまま落ちる（false だと meta の有無が結果に出ず、忘れても気づけない）。
      mobile: true,
      screenWidth: spec.width, screenHeight: spec.height,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: spec.scheme }],
    });

    // 前の文書を確実に手放してから開く。
    await send('Page.navigate', { url: 'about:blank' });
    const nav = await send('Page.navigate', { url: 'file://' + file });
    if (nav.errorText) throw new Error('ページを開けません: ' + nav.errorText);

    await waitFor('return document.readyState === "complete" && window.__pageToken ? 1 : 0',
      'ページの読み込み');

    const actual = await evaluate(
      'var root = document.documentElement;' +
      'return {' +
      '  token: window.__pageToken,' +
      '  clientWidth: root.clientWidth, clientHeight: root.clientHeight,' +
      '  innerWidth: window.innerWidth,' +
      '  dark: window.matchMedia("(prefers-color-scheme: dark)").matches,' +
      '  metaViewport: (document.querySelector("meta[name=viewport]") || {}).content || null' +
      '};');

    // ---- ここから「別のものを測っていないか」の確認。1つでも違えば測定失敗 ----
    if (actual.token !== token) {
      throw new Error('別のページを測っています（期待 ' + token + ' / 実際 ' + actual.token + '）');
    }
    if (actual.clientWidth !== spec.width) {
      throw new Error('指定した幅で描かれていません（指定 ' + spec.width + 'px / 実測 '
        + actual.clientWidth + 'px、viewport meta = ' + actual.metaViewport + '）');
    }
    if (actual.dark !== (spec.scheme === 'dark')) {
      throw new Error('指定した配色になっていません（指定 ' + spec.scheme
        + ' / 実測 ' + (actual.dark ? 'dark' : 'light') + '）');
    }
    return { token: token, viewport: actual };
  }

  return {
    open: open,
    evaluate: evaluate,
    waitFor: waitFor,
    close: async function () {
      try { ws.close(); } catch (_) {}
      process.removeListener('exit', cleanup);
      cleanup();
    },
  };
}

module.exports = { chromePath: chromePath, launch: launch };
