'use strict';
// バグ探しで見つかったデータ整合性のバグ（G1）の再現テスト。直したので緑で守る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects } = require('../pure_csv.js');
const { toCsv } = require('../pure_csv_write.js');

test('A1: 途中の空行は幻の空行オブジェクトにならず、書き戻しで ",," 行として永続化しない', () => {
  const rows = csvToObjects('a,b\n1,2\n\n3,4\n');
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.ok(!toCsv(rows, ['a', 'b']).includes('\n,\n'));
});

test('A1: カンマだけの行（全列が空）は書かれた内容として残す（toCsv との往復で行数を変えない）', () => {
  assert.deepEqual(csvToObjects('a,b\n1,2\n,\n3,4\n'), [{ a: '1', b: '2' }, { a: '', b: '' }, { a: '3', b: '4' }]);
});

test('A2: 引用符で始まらないフィールド中の " はただの文字で、以降の行を飲み込まない', () => {
  // 手書き CSV の「5" モニタ」のようなタイトル
  assert.deepEqual(parseCsv('a,b\n5" monitor,x\n3,4\n'), [['a', 'b'], ['5" monitor', 'x'], ['3', '4']]);
});

// --- B1: 2^53 を超える番号 ---
const PID = require('../pure_pbi_id.js');
const IID = require('../pure_impediment_id.js');

test('B1: nextPbiId は 2^53 を超える番号でも既存の ID を再利用しない', () => {
  assert.equal(PID.nextPbiId([{ id: 'PBI-9007199254740992' }], null), 'PBI-9007199254740993');
});

test('B1: nextPbiId は巨大な番号でも PBI-\\d+ 形式の ID を返す（指数表記・桁埋めの暴走をしない）', () => {
  assert.equal(PID.nextPbiId([{ id: 'PBI-' + '9'.repeat(25) }], null), 'PBI-1' + '0'.repeat(25));
  assert.equal(PID.nextPbiId([{ id: 'PBI-0099' }], null), 'PBI-0100');
});

test('B1: nextImpedimentId は巨大な番号でも IMP-\\d+ 形式の ID を返す', () => {
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-' + '9'.repeat(25) }]), 'IMP-1' + '0'.repeat(25));
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-9007199254740992' }]), 'IMP-9007199254740993');
});

test('B1: 高水位の比較・上限判定は 2^53 を超える番号でも正しい', () => {
  const big = 'PBI-9007199254740993';
  assert.equal(PID.maxPbiId(['PBI-9007199254740992', big]), big);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-9007199254740994', [], big), false);
  assert.equal(PID.isPbiIdWithinHighWater(big, [], big), true);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-000', [], big), false);
  assert.equal(PID.comparePbiIds('PBI-10', 'PBI-009'), 1);
});

// --- B2: コメントの target_id の前後の空白 ---
const CMT = require('../pure_comment.js');

test('B2: restoreComment は appendComment と同じく target_id の前後の空白を落として保存する', () => {
  const rs = CMT.restoreComment([], { id: 'CMT-00000003', target_id: ' PBI-1 ', author: 'a', created_at: '2026-10-01 00:00:00', body: 'x' });
  assert.equal(rs.ok, true);
  assert.equal(rs.rows[0].target_id, 'PBI-1');
});

test('B2: groupComments は前後に空白のある target_id を落として返す（キーと揃える）', () => {
  const g = CMT.groupComments([{ id: 'CMT-00000001', target_id: ' PBI-1 ', author: 'a', created_at: 't', body: 'x' }], 'a');
  assert.equal(g['PBI-1'][0].target_id, 'PBI-1');
});

// --- C: web_app 経由の再現（バグ探し C のフェイク） ---
const H = (function () {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const GAS_DIR = path.join(__dirname, '..');
  const PBI_FIELDS = ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'];
  const IMP_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
  const CMT_FIELDS = ['id', 'target_id', 'author', 'created_at', 'body'];
  const CHG_FIELDS = ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after'];
  const PBI_H = PBI_FIELDS.join(',');
  const IMP_H = IMP_FIELDS.join(',');
  const CMT_H = CMT_FIELDS.join(',');
  const CHG_H = CHG_FIELDS.join(',');

  function createCtx(files, fault) {
    fault = fault || {};
    let setCalls = 0;
    let uuidN = 0;
    let clock = Date.UTC(2026, 9, 6, 9, 0, 0);
    function it(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
    function makeFile(name) {
      return {
        getBlob: () => ({ getDataAsString: () => files[name] }),
        setContent: function (content) {
          setCalls++;
          if ((fault.setContentFailAt || []).indexOf(setCalls) !== -1 || (fault.setContentFailNames || []).indexOf(name) !== -1) {
            throw new Error('injected setContent failure #' + setCalls + ' ' + name);
          }
          files[name] = content;
        },
      };
    }
    const scrum = {
      getFilesByName: function (name) {
        if ((fault.readThrowNames || []).indexOf(name) !== -1) throw new Error('injected read failure ' + name);
        return Object.prototype.hasOwnProperty.call(files, name) ? it([makeFile(name)]) : it([]);
      },
      getFolders: () => it([]),
    };
    const root = { getFoldersByName: (n) => (n === 'scrum' ? it([scrum]) : it([])) };
    const props = { SCRUM_FOLDER_ID: 'fake' };
    const ctx = {
      console,
      DriveApp: { getFolderById: () => root },
      LockService: { getScriptLock: () => ({ tryLock: () => !fault.lockBusy, releaseLock: () => {} }) },
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => { if (fault.setPropFail) throw new Error('injected setProperty failure'); props[k] = v; },
      }) },
      Session: {
        getScriptTimeZone: () => 'UTC',
        getActiveUser: () => ({ getEmail: () => (fault.user === undefined ? 'me@example.com' : fault.user) }),
      },
      Utilities: {
        getUuid: () => { uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
        formatDate: (d) => {
          const p = (n) => (n < 10 ? '0' + n : String(n));
          return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
        },
      },
    };
    vm.createContext(ctx);
    // new Date() は呼ぶたびに1秒進む決定的な時計にする（引数付きはそのまま）。
    const RealDate = Date;
    ctx.Date = function (...a) { if (a.length) return new RealDate(...a); if (!fault.freezeClock) clock += 1000; return new RealDate(clock); };
    ctx.Date.UTC = RealDate.UTC;
    ctx.Date.now = () => clock;
    ctx.Date.prototype = RealDate.prototype;
    fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort().forEach((n) => {
      vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), ctx, { filename: n });
    });
    return { ctx, files, props, fault, setCalls: () => setCalls };
  }

  function baseFiles() {
    return {
      'product_backlog.csv': PBI_H + '\n', 'product_backlog_done.csv': PBI_H + '\n',
      'impediment_log.csv': IMP_H + '\n', 'impediment_log_resolved.csv': IMP_H + '\n',
      'comments.csv': CMT_H + '\n', 'change_log.csv': CHG_H + '\n',
    };
  }

  /** vm の値を native に直す（別レルムの配列・オブジェクトを deepEqual で比べるため）。 */
  function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /** テスト側の独立した RFC4180 パーサ（製品の parseCsv は使わない）。 */
  function parse(text) {
    const src = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
        continue;
      }
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && src[i + 1] === '\n') { /* CRLF は次の \n で区切る */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((c) => c.replace(/\r\n/g, '\n')));
  }
  function rowsOf(text, fields) {
    return parse(text).slice(1).map((r) => { const o = {}; fields.forEach((f, i) => { o[f] = i < r.length ? r[i] : ''; }); return o; });
  }
  function cell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsvText(rows, fields) {
    return [fields.join(',')].concat(rows.map((r) => fields.map((f) => cell(r[f])).join(','))).join('\n') + '\n';
  }

  /** mulberry32 */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
  }

  return { createCtx, baseFiles, plain, parse, rowsOf, toCsvText, rng, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS, PBI_H, IMP_H, CMT_H, CHG_H };
})();

const { createCtx, baseFiles, plain, rowsOf, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS } = H;
const IMP2 = 'IMP-002,止まっている,,マヤ,2026-10-01,Open,,,sprint001\n';
const IMP2_ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const full = (t) => ({ title: t, description: '', acceptance_criteria: '', status: 'New', priority: 'Medium', size: '', sprint: '' });

test('BUG C-5: 自分のコメントでも ID・日時が正規形でない行（ローカルで書いたもの）は、削除できるのに取り消せず失われる', () => {
  const f = baseFiles();
  f['comments.csv'] += 'CMT-ABCDEF12,PBI-002,me@example.com,2026-10-06 10:00:00,ローカルで書いた\n';
  const h = createCtx(f);
  const d = plain(h.ctx.apiDeleteComment('CMT-ABCDEF12'));
  assert.equal(d.ok, true, '前提: 削除はできる');
  const u = plain(h.ctx.apiRestoreComment(d.removed));
  assert.equal(u.ok, true, '削除の取り消しが拒否され、コメントが失われた: ' + u.message);
});

test('C-5: 日時が正規形でない自分のコメントも、削除を取り消せる（他人のものは戻せない）', () => {
  const f = baseFiles();
  f['comments.csv'] += 'CMT-0000000b,PBI-002,me@example.com,2026-10-06,日付だけ\n';
  const h = createCtx(f);
  const d = plain(h.ctx.apiDeleteComment('CMT-0000000b'));
  assert.equal(d.ok, true);
  assert.equal(plain(h.ctx.apiRestoreComment(Object.assign({}, d.removed, { author: 'you@example.com' }))).reason, 'forbidden');
  assert.equal(plain(h.ctx.apiRestoreComment(d.removed)).ok, true);
  assert.ok(f['comments.csv'].indexOf('CMT-0000000b,PBI-002,me@example.com,2026-10-06,日付だけ') !== -1);
});

test('BUG C-4: 作成の書き込みが失敗しても高水位だけ進み、次の作成で ID が欠番になる', () => {
  const f = baseFiles();
  const h = createCtx(f, { setContentFailNames: ['product_backlog.csv'] });
  assert.equal(plain(h.ctx.apiCreatePbi(full('A'))).reason, 'error');
  h.fault.setContentFailNames = [];
  const ok = plain(h.ctx.apiCreatePbi(full('B')));
  assert.equal(ok.id, 'PBI-001', '失敗した作成が PBI-001 を消費した（高水位: ' + h.props.LAST_PBI_ID + '）');
});

test('BUG C-2: 雛形の PBI-001 と同じ ID の本物の行は、盤面に出るのに状態変更・削除が永久に conflict になる', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-001,（PBIタイトル）,（説明）,（受入基準）,Critical/High/Medium/Low,0,New,,YYYY-MM-DD,YYYY-MM-DD\n' +
    'PBI-001,本物,,,High,3,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n';
  const h = createCtx(f);
  const card = plain(h.ctx.apiGetView('board')).view.columns[0].cards[0];
  assert.equal(card.title, '本物', '前提: 盤面には本物の行だけが出る');
  const moved = plain(h.ctx.apiUpdateStatus('PBI-001', 'Ready', card.updated_at));
  assert.equal(moved.ok, true, '画面が見た updated_at で動かせない: ' + moved.reason);
});

test('BUG C-3: 同じ ID の行が2つあると、削除は1つ目を消すのに removed は2つ目を返し、取り消しで消した行を戻せない', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-002,first,,,,,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n' +
    'PBI-002,second,,,,,New,,2026-10-01 00:00:00,2026-10-02 00:00:00\n';
  const h = createCtx(f);
  const del = plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:00'));
  assert.equal(del.ok, true);
  const left = rowsOf(f['product_backlog.csv'], PBI_FIELDS).map((r) => r.title);
  assert.deepEqual(left, ['second'], '前提: 1つ目（first）が消えた');
  assert.equal(del.removed.title, 'first', 'removed（取り消し用）が実際に消した行と違う: ' + del.removed.title);
});

test('BUG C-3b: 同じ ID の行が2つあると、削除の履歴が delete ではなく存在しない update（title first→second）になる', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-002,first,,,,,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n' +
    'PBI-002,second,,,,,New,,2026-10-01 00:00:00,2026-10-02 00:00:00\n';
  const h = createCtx(f);
  assert.equal(plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:00')).ok, true);
  const hist = rowsOf(f['change_log.csv'], CHG_FIELDS);
  assert.ok(hist.every((r) => r.action !== 'update'), '削除で update の履歴が出た: ' + JSON.stringify(hist));
});

test('BUG C-6: 未解決に雛形 IMP-001 と本物の IMP-001 があると、本物の編集が履歴に残らず警告も出ない', () => {
  const f = baseFiles();
  f['impediment_log.csv'] += 'IMP-001,（障害物タイトル）,（詳細説明）,（報告者）,YYYY-MM-DD,Open,,（解決策）,sprint001\n' +
    'IMP-001,本物,,マヤ,2026-10-01,Open,,,\n';
  const h = createCtx(f);
  const exp = { id: 'IMP-001', title: '本物', description: '', reported_by: 'マヤ', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' };
  const res = plain(h.ctx.apiUpdateImpediment('IMP-001', { title: '本物2', description: '', reported_by: 'マヤ', sprint: '' }, exp));
  assert.equal(res.ok, true);
  assert.ok(f['impediment_log.csv'].indexOf('本物2') !== -1, '前提: 書けている');
  const hist = rowsOf(f['change_log.csv'], CHG_FIELDS);
  assert.ok(res.historyWarning || hist.some((r) => r.target_id === 'IMP-001' && r.field === 'title'),
    '編集が記録されず、historyWarning も無い');
});

const PH_PBI1 = 'PBI-001,（PBIタイトル）,（説明）,（受入基準）,Critical/High/Medium/Low,0,New,,YYYY-MM-DD,YYYY-MM-DD\n';

test('C-2: 雛形と同じ ID の本物の PBI は、状態変更・編集・削除・取り消しができ、履歴にも正しく残る。雛形は残る', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += PH_PBI1 + 'PBI-001,本物,,,High,3,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n';
  const h = createCtx(f);
  const card = () => plain(h.ctx.apiGetView('board')).view.columns.flatMap((c) => c.cards).find((c) => c.id === 'PBI-001');
  assert.equal(plain(h.ctx.apiUpdateStatus('PBI-001', 'Ready', card().updated_at)).ok, true);
  const edited = Object.assign(full('本物2'), { status: 'Ready', priority: 'High', size: '3' });
  assert.equal(plain(h.ctx.apiUpdatePbi('PBI-001', edited, card().updated_at)).ok, true);
  const del = plain(h.ctx.apiDeletePbi('PBI-001', card().updated_at));
  assert.equal(del.ok, true);
  assert.equal(del.removed.title, '本物2');
  assert.ok(f['product_backlog.csv'].indexOf('（PBIタイトル）') !== -1, '雛形は消えない');
  assert.equal(plain(h.ctx.apiRestorePbi(del.removed)).ok, true, '雛形があっても本物の行を戻せる');
  assert.equal(card().title, '本物2');
  const hist = rowsOf(f['change_log.csv'], CHG_FIELDS).filter((r) => r.target_id === 'PBI-001');
  assert.deepEqual(hist.map((r) => r.action + ':' + r.field), ['update:status', 'update:title', 'delete:', 'restore:']);
});

test('C-3: 同じ ID の行が2つあると、最初の行を消して返し、履歴は delete、取り消しで元に戻る', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-002,first,,,,,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n' +
    'PBI-002,second,,,,,New,,2026-10-01 00:00:00,2026-10-02 00:00:00\n';
  const h = createCtx(f);
  const del = plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:00'));
  assert.equal(del.ok, true);
  assert.equal(del.removed.title, 'first');
  assert.deepEqual(rowsOf(f['change_log.csv'], CHG_FIELDS).map((r) => r.action), ['delete']);
  // 取り消しで消した行（first）が戻る。二重に押しても増えない。
  assert.equal(plain(h.ctx.apiRestorePbi(del.removed)).ok, true, '消した行を戻せない');
  assert.equal(plain(h.ctx.apiRestorePbi(del.removed)).reason, 'duplicate_id');
  assert.deepEqual(rowsOf(f['product_backlog.csv'], PBI_FIELDS).map((r) => r.title), ['second', 'first']);
  assert.deepEqual(rowsOf(f['change_log.csv'], CHG_FIELDS).map((r) => r.action), ['delete', 'restore']);
});

test('C-3: sharedId の無い取り消しは、同じ ID の別の行があれば従来どおり重複として拒む', () => {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-002,second,,,,,New,,2026-10-01 00:00:00,2026-10-02 00:00:00\n';
  const h = createCtx(f);
  const row = { id: 'PBI-002', title: 'first', status: 'New', created_at: '2026-10-01 00:00:00', updated_at: 't' };
  assert.equal(plain(h.ctx.apiRestorePbi(row)).reason, 'duplicate_id');
});

test('BUG C-7: change_log.csv の末尾が閉じていない引用符で終わると、以後の履歴が黙って既存セルに飲み込まれる', () => {
  const f = baseFiles();
  f['change_log.csv'] += 'CHG-0000000a,2026-10-01 00:00:00,a,PBI-002,update,title,"途中で切れた\n';
  f['product_backlog.csv'] += 'PBI-002,t,,,,,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n';
  const h = createCtx(f);
  const res = plain(h.ctx.apiUpdateStatus('PBI-002', 'Ready', '2026-10-01 00:00:00'));
  assert.equal(res.ok, true);
  const entries = plain(h.ctx.apiGetHistory('PBI-002')).entries;
  assert.ok(res.historyWarning || entries.some((e) => e.field === 'status' && e.after === 'Ready'),
    '記録が読めないのに historyWarning も無い: ' + JSON.stringify(entries).slice(0, 200));
});

test('C-7: 末尾が閉じていない change_log には足さず、決まった警告を返す（本体は書ける）', () => {
  const f = baseFiles();
  const broken = f['change_log.csv'] + 'CHG-0000000a,2026-10-01 00:00:00,a,PBI-002,update,title,"途中で切れた\n';
  f['change_log.csv'] = broken;
  f['product_backlog.csv'] += 'PBI-002,t,,,,,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n';
  const h = createCtx(f);
  const res = plain(h.ctx.apiUpdateStatus('PBI-002', 'Ready', '2026-10-01 00:00:00'));
  assert.equal(res.ok, true);
  assert.equal(res.historyWarning, '変更履歴のファイルが壊れています（引用符が閉じていません）。docs/setup.md の手順で切り替えてください');
  assert.equal(f['change_log.csv'], broken, '壊れたファイルに足していない');
});

test('C-7: csvEndsInsideQuotes は parseCsv と同じ読み方で、閉じていない引用符だけを見つける', () => {
  const { csvEndsInsideQuotes } = require('../pure_csv.js');
  assert.equal(csvEndsInsideQuotes('a,b\n"x\n'), true);
  assert.equal(csvEndsInsideQuotes('a,b\n"x""y\n'), true);
  assert.equal(csvEndsInsideQuotes('a,b\n"x""y",z\n'), false);
  assert.equal(csvEndsInsideQuotes('a,b\n5" monitor,x\n'), false, 'セルの途中の " は引用の始まりではない');
  assert.equal(csvEndsInsideQuotes('a,b\r\n"x\r\ny",z\r\n'), false);
  assert.equal(csvEndsInsideQuotes(''), false);
});
