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
];

const VELOCITY = [
  { sprint: 'sprint001', planned_points: '10', completed_points: '8', carried_over_points: '2',
    sprint_start: '2026-08-01', sprint_end: '2026-08-14', notes: '' },
  { sprint: 'sprint002', planned_points: '12', completed_points: '12', carried_over_points: '0',
    sprint_start: '2026-08-15', sprint_end: '2026-08-28', notes: '' },
  { sprint: 'sprint003', planned_points: '14', completed_points: '', carried_over_points: '',
    sprint_start: '2026-08-29', sprint_end: '2026-09-11', notes: '' },
];

const SPRINT_MD = [
  '# スプリントバックログ', '', '## スプリントゴール', '',
  '同期の失敗が画面から分かり、その場で直せる状態にする。', '', '## PBI', '',
].join('\n');

const IMPEDIMENT_OPEN = [
  { id: 'IMP-001', title: 'Drive の共有設定が分からない', detail: '配布先の権限', raised_by: 'マヤ',
    raised_at: '2026-09-01', owner: 'ケンジ', due: '2026-09-08', status: 'open' },
];
const IMPEDIMENT_RESOLVED = [
  { id: 'IMP-000', title: 'clasp のログインが通らない', detail: '個人アカウント', raised_by: 'ダイチ',
    raised_at: '2026-08-20', owner: 'ケンジ', due: '2026-08-22', status: 'resolved' },
];

function viewFor(name) {
  switch (name) {
    case 'board': return { view: buildBoardData(ROWS), summary: summarizeBacklog(ROWS, KANBAN_STATUSES) };
    case 'list': return { view: buildListView(ROWS), summary: summarizeBacklog(ROWS, KANBAN_STATUSES) };
    case 'done': return { view: buildDoneView(ROWS), summary: null };
    case 'burndown': return { view: buildBurndownView(ROWS, VELOCITY), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    case 'velocity': return { view: buildVelocityView(VELOCITY), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    case 'roadmap': return { view: buildRoadmapView(ROWS, VELOCITY), summary: summarizeSprint(VELOCITY, SPRINT_MD) };
    case 'impediment':
      return { view: buildImpedimentView(IMPEDIMENT_OPEN, IMPEDIMENT_RESOLVED),
        summary: summarizeImpediment(IMPEDIMENT_OPEN, IMPEDIMENT_RESOLVED) };
    default: return { view: null, summary: null };
  }
}

const VIEW_NAMES = ['board', 'list', 'done', 'burndown', 'velocity', 'roadmap', 'impediment'];

/** apiGetView の応答を、ビュー名をキーに全部作って返す。 */
function responses() {
  const out = {};
  VIEW_NAMES.forEach(function (name) {
    const r = viewFor(name);
    out[name] = { ok: true, name: name, view: r.view, summary: r.summary };
  });
  // スプリントの選択肢は盤面の応答だけが運ぶ（サーバ側が完成させて返す）。
  out.board.sprintChoices = sprintChoices(VELOCITY, ROWS);
  return out;
}

module.exports = { responses: responses, VIEW_NAMES: VIEW_NAMES, ROWS: ROWS, VELOCITY: VELOCITY };
