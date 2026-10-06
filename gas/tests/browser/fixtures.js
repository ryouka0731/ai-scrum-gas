'use strict';
/**
 * 実ブラウザに食わせる見本の応答。
 *
 * 手書きの JSON にしない。`pure_*` を require して組み立てることで、サーバ側の
 * 返す形を変えたときに見本も自動で追随する（手書きだと、画面は壊れているのに
 * 検査だけが古い形で通り続ける）。
 *
 * 中身は「現実に近い」形にする。空だと「ありません。」しか描かれず、補足も表も
 * 出ないので、何も確かめられない。
 */

const { buildBoardData } = require('../../pure_board_view.js');
const { buildListView, buildDoneView } = require('../../pure_view_backlog.js');
const { buildBurndownView, buildVelocityView, buildRoadmapView } = require('../../pure_view_sprint.js');
const { buildImpedimentView } = require('../../pure_view_impediment.js');
const { summarizeBacklog, summarizeSprint, summarizeImpediment } = require('../../pure_summary.js');
const { KANBAN_STATUSES } = require('../../pure_grid_board.js');
const { sprintChoices } = require('../../pure_sprint_options.js');
const { groupComments } = require('../../pure_comment.js');
const { historyFor, HISTORY_LIMIT } = require('../../pure_history.js');

const ROWS = [
  { id: 'PBI-001', title: '同期の失敗を画面に出す', status: 'New', priority: 'High', size: '3',
    sprint: 'sprint003', acceptance_criteria: '失敗が画面に出る;再実行できる', updated_at: '2026-09-01 10:00:00' },
  { id: 'PBI-002',
    title: 'カンバンから状態を変えられるようにする。長いタイトルのときに折り返しが効くかどうかも一緒に見たいので、わざと長くしている。',
    status: 'In Progress', priority: 'Critical', size: '8',
    sprint: 'sprint003', acceptance_criteria: 'ドラッグで動く', updated_at: '2026-09-02 11:00:00' },
  { id: 'PBI-003', title: '障害物ログを画面から書けるようにする', status: 'Done', priority: 'Medium', size: '5',
    sprint: 'sprint002', acceptance_criteria: '書ける;解決済にできる', updated_at: '2026-09-03 12:00:00' },
  { id: 'PBI-004', title: 'ロードマップを出す', status: 'Ready', priority: 'Low', size: '2',
    sprint: '', acceptance_criteria: '帯が出る', updated_at: '2026-09-04 13:00:00' },
  { id: 'PBI-005', title: 'velocity.csv に無いスプリントが付いた項目', status: 'New', priority: 'Medium', size: '1',
    sprint: '旧スプリント', acceptance_criteria: '選択肢に残る', updated_at: '2026-09-05 09:00:00' },
  // この PBI は「途中で折り返せない長い連なり」（URL）を持つために在る。**消さないこと。**
  // 消すと `.card .title`（一覧では title の td も兼ねる）の overflow-wrap の検査が
  // 空振りになる（規則を消しても落ちなくなる）。日本語と空白だけのタイトルは、
  // 規則が無くても折り返せてしまうため。一覧の title 列の td（`kanban_browser.test.js`
  // の「表の中の折り返せない連なりは、表の枠より広くならない」）も同じこの値で守っている。
  // 優先度は空にしておく（用語集に無いので補足が増えず、補足の件数を動かさない）。
  { id: 'PBI-006',
    title: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij/edit#gid=0 の共有設定を直す',
    status: 'Ready', priority: '', size: '',
    sprint: '', acceptance_criteria: '共有先が正しい', updated_at: '2026-09-06 09:00:00' },
];

const VELOCITY = [
  { sprint: 'sprint001', planned_points: '10', completed_points: '8', carried_over_points: '2',
    sprint_start: '2026-08-01', sprint_end: '2026-08-14', notes: '' },
  { sprint: 'sprint002', planned_points: '12', completed_points: '12', carried_over_points: '0',
    sprint_start: '2026-08-15', sprint_end: '2026-08-28', notes: '' },
  { sprint: 'sprint003', planned_points: '14', completed_points: '', carried_over_points: '',
    sprint_start: '2026-08-29', sprint_end: '2026-09-11', notes: '' },
];

// sprintXXX/sprint_backlog.md の見本。バーンダウンのビューとスプリントの要約
// （ゴール）の2つがここから作られる。
//
// スプリントゴールは人が書く文章。URL を貼ることは普通にあり、日本語と空白だけの
// 文章と違って「途中で折り返せない長い連なり」を持つ。**消さないこと。** 消すと
// `#summary .goal` の overflow-wrap の検査（375px でページが横に伸びないこと）が
// 空振りになる。
//
// 「バーンダウン」の節も**消さないこと。** 節が無いと buildBurndownGrid が null を
// 返し、バーンダウンのビューは「まだありません。」だけになる。7つあるビューのうち
// そこだけ実ブラウザで一度も表を描かない状態に戻る（列の見出しの書式は
// scrum/sprintSAMPLE/sprint_backlog.md に合わせてある）。
const SPRINT_MD = [
  '# スプリントバックログ', '', '## スプリントゴール', '',
  '同期の失敗が画面から分かり、その場で直せる状態にする。'
    + ' 詳細: https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghij/edit',
  '', '## バーンダウン', '',
  '| 日付 | 残タスク数 | 残ポイント |',
  '|------|------------|------------|',
  '| 2026-08-29 | 12 | 14 |',
  '| 2026-09-01 | 9 | 11 |',
  '| 2026-09-04 | 5 | 6 |',
  '| 2026-09-08 | 2 | 3 |',
  '', '## PBI', '',
].join('\n');

// 障害物の CSV と同じ全列（IMPEDIMENT_FIELDS）を持たせる。未解決は必ず1件以上
// 置くこと（障害物パネルの幅の検査が、未解決の行を押して開くため）。
const IMPEDIMENT_OPEN = [
  { id: 'IMP-001', title: 'Drive の共有設定が分からない', description: '配布先の権限', reported_by: 'マヤ',
    reported_at: '2026-09-01', status: 'open', resolved_at: '', resolution: '', sprint: 'sprint003' },
];
const IMPEDIMENT_RESOLVED = [
  { id: 'IMP-000', title: 'clasp のログインが通らない', description: '個人アカウント', reported_by: 'ダイチ',
    reported_at: '2026-08-20', status: 'resolved', resolved_at: '2026-08-22', resolution: '管理者のアカウントで通した',
    sprint: 'sprint002' },
];

// コメントを大量に持たせる PBI。パネルが縦に伸びて「保存」へ届くかを実ブラウザで見るために在る。
// 他の検査（先頭のカードを削除する、2枚目を開く等）の対象と重ならない Ready の列の PBI を選ぶ。
// **消さない・件数を減らさないこと。** 減らすと 901px 以上でパネルが内側でスクロールしなくなり、
// 「届く」の検査が空振りになる（kanban_browser.test.js が scrollHeight > clientHeight を見ている）。
const COMMENT_PBI = 'PBI-004';
const COMMENT_ME = 'マヤ';
const COMMENT_COUNT = 20;
const LONG_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefghijKLMNOPQRSTUVWXYZ/edit#gid=0&range=A1:Z999';

/** groupComments が食う行（comments.csv と同じ列）。手書きの応答は作らず、これを通して組み立てる。 */
function commentRows() {
  const rows = [];
  for (let i = 1; i <= COMMENT_COUNT; i++) {
    const n = ('0' + i).slice(-2);
    rows.push({
      id: 'CMT-' + n, target_id: COMMENT_PBI,
      author: i % 3 === 0 ? COMMENT_ME : 'ダイチ',
      created_at: '2026-09-10 10:' + n + ':00',
      // 3の倍数は改行を含む、4の倍数は途中で折り返せない長い URL を含む。
      body: (i % 4 === 0 ? '確認用: ' + LONG_URL : 'コメント' + n + '件目。')
        + (i % 3 === 0 ? '\n2行目です。\n\n4行目（空行の後）。' : ''),
    });
  }
  return rows;
}

// 長い履歴を持たせる PBI（コメント20件と同じ PBI-004）。パネルが縦にも横にも伸びる状況を作る。
// **消さない・件数を減らさないこと。** 説明の差分は .history-line（長い URL を含む）を作り、
// 「節の幅を超えない」「保存へ届く」の検査の空振りを防ぐ。
const HISTORY_PBI = COMMENT_PBI;
const HISTORY_COUNT = 40;
const HISTORY_URL = LONG_URL + '&' + 'x'.repeat(120);

/** historyFor が食う行（change_log.csv と同じ列）。 */
function historyLogRows() {
  const rows = [];
  for (let i = 1; i <= HISTORY_COUNT; i++) {
    const n = ('0' + i).slice(-2);
    const at = '2026-09-' + ('0' + (1 + (i % 28))).slice(-2) + ' 09:' + n + ':00';
    const base = { id: 'LOG-' + n, at: at, actor: i % 3 === 0 ? COMMENT_ME : 'ダイチ', target_id: HISTORY_PBI };
    if (i % 5 === 0) {
      rows.push(Object.assign({}, base, { action: 'update', field: 'status', before: 'New', after: 'Ready' }));
    } else {
      // 説明の大きな書き換え。行ごとに長い URL を含め、同じ行も混ぜる。
      const before = ['概要' + n, '参考: ' + HISTORY_URL, '共通の行', '旧メモ ' + n].join('\n');
      const after = ['概要' + n + '（改）', '参考: ' + HISTORY_URL + '#v' + n, '共通の行',
        '新メモ ' + n + ' ' + HISTORY_URL].join('\n');
      rows.push(Object.assign({}, base, { action: 'update', field: 'description', before: before, after: after }));
    }
  }
  // 別の対象の履歴も混ぜる（historyFor が絞れていること）。
  rows.push({ id: 'LOG-99', at: '2026-09-30 09:00:00', actor: 'ダイチ', target_id: 'PBI-001',
    action: 'update', field: 'title', before: 'a', after: 'b' });
  return rows;
}

function viewFor(name) {
  switch (name) {
    case 'board': return { view: buildBoardData(ROWS), summary: summarizeBacklog(ROWS, KANBAN_STATUSES) };
    case 'list': return { view: buildListView(ROWS), summary: summarizeBacklog(ROWS, KANBAN_STATUSES) };
    // 完了の要約は完了バックログ自身の集計（web_app.js の apiGetView('done') と同じ）。
    // ここを null に戻すと、やることタブの中で要約の行が現れて消える状態に逆戻りする。
    case 'done': return { view: buildDoneView(ROWS), summary: summarizeBacklog(ROWS, KANBAN_STATUSES) };
    // buildBurndownView が受け取るのは sprint_backlog.md の本文ひとつだけ。
    // ここに ROWS（PBI の配列）を渡していたため、view はずっと null だった。
    case 'burndown': return { view: buildBurndownView(SPRINT_MD), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    case 'velocity': return { view: buildVelocityView(VELOCITY), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    case 'roadmap': return { view: buildRoadmapView(ROWS, VELOCITY), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    // impedimentPayload_（web_app.js）と同じ形: view / summary / sprintChoices。
    case 'impediment':
      return { view: buildImpedimentView(IMPEDIMENT_OPEN, IMPEDIMENT_RESOLVED),
        summary: summarizeImpediment(IMPEDIMENT_OPEN, IMPEDIMENT_RESOLVED),
        sprintChoices: sprintChoices(VELOCITY, IMPEDIMENT_OPEN.concat(IMPEDIMENT_RESOLVED)) };
    default: return { view: null, summary: null };
  }
}

const VIEW_NAMES = ['board', 'list', 'done', 'burndown', 'velocity', 'roadmap', 'impediment'];

/** apiGetView の応答を、ビュー名をキーに全部作って返す。 */
function responses() {
  const out = {};
  VIEW_NAMES.forEach(function (name) {
    const r = viewFor(name);
    out[name] = { ok: true, name: name, view: r.view, summary: r.summary,
      comments: groupComments(commentRows(), COMMENT_ME) };
    if (r.sprintChoices) out[name].sprintChoices = r.sprintChoices;
  });
  // スプリントの選択肢は盤面の応答だけが運ぶ（サーバ側が完成させて返す）。
  out.board.sprintChoices = sprintChoices(VELOCITY, ROWS);
  return out;
}

/** apiGetHistory の応答。サーバ（apiGetHistory）と同じく historyFor で絞る。 */
function historyResponse(targetId) {
  return { ok: true, entries: historyFor(historyLogRows(), targetId, HISTORY_LIMIT) };
}

module.exports = { responses: responses, historyResponse: historyResponse, HISTORY_PBI: HISTORY_PBI, HISTORY_COUNT: HISTORY_COUNT, COMMENT_PBI: COMMENT_PBI, COMMENT_COUNT: COMMENT_COUNT, VIEW_NAMES: VIEW_NAMES, ROWS: ROWS, VELOCITY: VELOCITY };
