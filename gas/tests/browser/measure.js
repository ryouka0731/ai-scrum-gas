'use strict';
/**
 * 実ブラウザで kanban.html を開き、幅と配色の組み合わせごとに測る。
 *
 * 検査（*.test.js）は「測る」と「判定する」を分けている。判定を測定の中に埋めると、
 * 落ちたときにどの条件の何が幾つだったのかが残らない。
 *
 * 単体でも動く: `node gas/tests/browser/measure.js [幅[,幅…]] [light|dark]`
 */

const fs = require('node:fs');
const path = require('node:path');
const { launch, chromePath } = require('./chrome_session.js');
const { buildStandalonePage } = require('./standalone_page.js');

const PROBE_SOURCE = fs.readFileSync(path.join(__dirname, 'probe_source.js'), 'utf8');

/** 検査する幅。900 / 901 は @media (max-width: 900px) の両側。 */
const WIDTHS = [375, 600, 900, 901, 1024, 1440];
const SCHEMES = ['light', 'dark'];
const HEIGHT = 800;

/** 表のビュー（#table-view を使うもの）のうち、代表として測るビューのラベル。 */
const TABLE_VIEW_LABEL = '一覧';
/** 盤面へ戻るときのビューのラベル。 */
const BOARD_VIEW_LABEL = '盤面';

/**
 * 補足の ? を押す場所。置かれた先が違えば、押した click の行き先も違う。
 * カードの中の ? は click が .card まで上がりうるので、必ず含める。
 */
const HELP_PRESS_SPOTS = {
  columnHeader: '#board .column > h2 .help',
  card: '#board .card .help',
  tableHeader: '#table-view th .help',
};

async function installProbe(session) {
  const ok = await session.evaluate(PROBE_SOURCE + '\nreturn !!(window.__probe);');
  if (!ok) throw new Error('測定用のスクリプトをページに入れられませんでした');
}

/** 盤面と表の両方の状態を1つの条件で測る。 */
async function measureOne(session, html, spec) {
  const where = spec.width + 'px / ' + spec.scheme;
  const opened = await session.open({
    html: html, width: spec.width, height: spec.height || HEIGHT, scheme: spec.scheme,
  });
  await installProbe(session);
  await session.waitFor('return window.__probe.boardReady() ? 1 : 0', where + ' の初回読み込み');

  const board = {
    viewport: await session.evaluate('return window.__probe.viewport();'),
    overflow: await session.evaluate('return window.__probe.overflow();'),
    // `.column` の `min-width: 0`。今の見本では振る舞いに現れない備え（z-index と同型）。
    // 詳細は probe_source.js の columnMinWidth のコメントを参照。
    columnMinWidth: await session.evaluate('return window.__probe.columnMinWidth();'),
    hidden: await session.evaluate('return window.__probe.hiddenAudit();'),
    tap: await session.evaluate('return window.__probe.tapTargets();'),
    contrast: await session.evaluate('return window.__probe.contrastAudit();'),
    helps: await session.evaluate('return window.__probe.helpAudit("board");'),
    pressColumnHeaderHelp: await session.evaluate(
      'return window.__probe.pressHelp(' + JSON.stringify(HELP_PRESS_SPOTS.columnHeader) + ');'),
    pressCardHelp: await session.evaluate(
      'return window.__probe.pressHelp(' + JSON.stringify(HELP_PRESS_SPOTS.card) + ');'),
  };

  await session.evaluate('window.scrollTo(0, 0); return 1;');
  await session.evaluate('return window.__probe.clickIn("views", ' + JSON.stringify(TABLE_VIEW_LABEL) + ');');
  await session.waitFor('return window.__probe.tableReady() ? 1 : 0', where + ' の表の読み込み');

  const table = {
    overflow: await session.evaluate('return window.__probe.overflow();'),
    hidden: await session.evaluate('return window.__probe.hiddenAudit();'),
    tap: await session.evaluate('return window.__probe.tapTargets();'),
    contrast: await session.evaluate('return window.__probe.contrastAudit();'),
    helps: await session.evaluate('return window.__probe.helpAudit("table-view");'),
    pressTableHeaderHelp: await session.evaluate(
      'return window.__probe.pressHelp(' + JSON.stringify(HELP_PRESS_SPOTS.tableHeader) + ');'),
    // PBI-006（fixtures.js）の URL のセル。折り返せていなければ表全体が押し広げられる
    // （`td { overflow-wrap: anywhere; }` を消しても「ページが横に伸びる」検査は
    // .table-wrap の overflow-x に吸収されて空振りになるため、別に直接見る）。
    wideCell: await session.evaluate('return window.__probe.wideTokenCell();'),
  };

  // 通知とパネルの重なりは盤面で見る（削除も新しいパネルも盤面から起こる）。
  // 画面の状態を変えるので、他の測定がすべて終わってから最後に行う。
  await session.evaluate('window.scrollTo(0, 0); return 1;');
  await session.evaluate('return window.__probe.clickIn("views", ' + JSON.stringify(BOARD_VIEW_LABEL) + ');');
  await session.waitFor('return window.__probe.boardReady() ? 1 : 0', where + ' の盤面への戻り');
  // パネルを閉じた状態での通知の中央寄せは、toastOverPanel より**先に**行う。
  // toastOverPanel は PBI-006（長いタイトル）を消すため、その直後に別の削除を
  // 重ねると、375/600px で通知の中央寄せが一時的に崩れる（実測: documentElement.
  // scrollWidth が 702px まで広がった状態のまま次の通知が出る。headless Chrome の
  // mobile エミュレーションでの一時的な描画の揺れとみられる。短いタイトル同士の
  // 連続削除では再現しないことを切り分け済み）。先に短い見本で中央寄せを測ってから
  // 最後に PBI-006 を消す順にすれば安定する。
  const toastClosed = await session.evaluate('return window.__probe.toastCenteredWhilePanelClosed();');
  const toast = await session.evaluate('return window.__probe.toastOverPanel();');

  return {
    width: spec.width, height: spec.height || HEIGHT, scheme: spec.scheme,
    where: where, token: opened.token, actualViewport: opened.viewport,
    board: board, table: table, toast: toast, toastClosed: toastClosed,
  };
}

/**
 * 全条件を測って配列で返す。Chrome は最初に1つだけ起こし、最後に必ず落とす。
 *
 * @param {{widths?: number[], schemes?: string[], height?: number}} [opts]
 */
async function measureAll(opts) {
  const o = opts || {};
  const widths = o.widths || WIDTHS;
  const schemes = o.schemes || SCHEMES;
  const html = buildStandalonePage();
  const session = await launch();
  const results = [];
  try {
    for (const scheme of schemes) {
      for (const width of widths) {
        results.push(await measureOne(session, html, {
          width: width, height: o.height || HEIGHT, scheme: scheme,
        }));
      }
    }
  } finally {
    await session.close();
  }
  return results;
}

module.exports = {
  measureAll: measureAll,
  measureOne: measureOne,
  installProbe: installProbe,
  PROBE_SOURCE: PROBE_SOURCE,
  WIDTHS: WIDTHS,
  SCHEMES: SCHEMES,
  HEIGHT: HEIGHT,
  TABLE_VIEW_LABEL: TABLE_VIEW_LABEL,
  BOARD_VIEW_LABEL: BOARD_VIEW_LABEL,
  HELP_PRESS_SPOTS: HELP_PRESS_SPOTS,
};

if (require.main === module) {
  if (!chromePath()) {
    console.error('Chrome が見つかりません（CHROME_PATH で指定できます）');
    process.exit(1);
  }
  const widths = process.argv[2] ? process.argv[2].split(',').map(Number) : undefined;
  const schemes = process.argv[3] ? [process.argv[3]] : undefined;
  measureAll({ widths: widths, schemes: schemes })
    .then(function (r) { console.log(JSON.stringify(r, null, 2)); })
    .catch(function (e) { console.error(e); process.exit(1); });
}
