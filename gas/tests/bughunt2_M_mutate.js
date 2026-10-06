#!/usr/bin/env node
'use strict';
/**
 * 2巡目 M: 依存なしの簡易ミューテーションテスト実行器。
 *
 * npm test の対象（*.test.js）ではない。手で走らせる:
 *   node gas/tests/bughunt2_M_mutate.js [--workers 4] [--seed 1] [--cap web_app.js=120,default=40]
 *        [--targets gas/pure_merge.js,...] [--ids-from result.json] [--confirm] [--full] [--baseline]
 *        [--out result.json]
 *
 *   --baseline  自分の殺しテスト（bughunt2_M_*）を外して走らせる（足す前の得点を測る）
 *   --full      絞らずに全テスト（npm test と同じ gas/tests/*.test.js）で走らせる
 *   --with-slow 絞った集合に、遅いため普段は外すテスト（SLOW_TESTS）も入れる
 *   --confirm   絞った集合で生き残った変異だけ全テストで確かめ直す
 *
 * 作業木そのものは書き換えない。リポジトリを一時ディレクトリへ写し（.git / node_modules /
 * .claude/worktrees を除く）、その写しの中で対象ファイルを1つずつ変異させてテストを走らせ、
 * 毎回 try/finally で元に戻す。終わったら写しを消す。
 *
 * 変異の種類: ===/!==, ==/!=, < <=, > >=, &&/||, true/false, if 条件の否定,
 * 早期 return の無効化（if (X) return → if (false) return）, 比較相手の文字列の置換,
 * +1 → +0 / -1 → -0, 関数内の1文の削除。
 * 構文として壊れる変異は vm.Script で検出して除外する（invalid）。
 *
 * テストは対象ごとに絞る: そのファイル名を参照するテスト（ローカル helper 経由も含む）と、
 * gas/ を丸ごと vm に読み込むテスト。--confirm を付けると、絞った集合で生き残った変異を
 * 全テストでもう一度確かめる。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TEST_DIR = path.join(ROOT, 'gas', 'tests');
const DEFAULT_TARGETS = [
  'gas/web_app.js', 'gas/pure_merge.js', 'gas/pure_impediment_merge.js', 'gas/pure_comment.js',
  'gas/pure_history.js', 'gas/pure_csv.js', 'gas/pure_view_impediment.js', 'gas/pure_pbi_id.js',
  'scripts/publish.js',
];

// 遅い（1本で十数秒）ため、絞った集合からは外し --confirm の全テストで拾う。
const SLOW_TESTS = ['bughunt_d_fuzz.test.js'];

function parseArgs(argv) {
  const o = { workers: 4, seed: 1, cap: { 'web_app.js': 120, default: 40 }, targets: DEFAULT_TARGETS,
    idsFrom: null, confirm: false, full: false, withSlow: false, baseline: false, out: null, timeoutMs: 180000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--workers') o.workers = Number(v());
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--targets') o.targets = v().split(',');
    else if (a === '--ids-from') o.idsFrom = v();
    else if (a === '--confirm') o.confirm = true;
    else if (a === '--full') o.full = true;
    else if (a === '--with-slow') o.withSlow = true;
    else if (a === '--baseline') o.baseline = true;
    else if (a === '--out') o.out = v();
    else if (a === '--timeout') o.timeoutMs = Number(v());
    else if (a === '--cap') {
      o.cap = {};
      v().split(',').forEach((kv) => { const [k, n] = kv.split('='); o.cap[k] = Number(n); });
      if (!('default' in o.cap)) o.cap.default = 40;
    } else throw new Error('unknown arg ' + a);
  }
  return o;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 行の中で文字列リテラル・行コメントの位置を true にした配列を返す（簡易）。 */
function codeMask(line) {
  const mask = new Array(line.length).fill(false); // true = コードではない
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      mask[i] = true;
      if (c === '\\') { mask[i + 1] = true; i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { q = c; mask[i] = true; continue; }
    if (c === '/' && line[i + 1] === '/') { for (let j = i; j < line.length; j++) mask[j] = true; break; }
    if (c === '/' && /[(,=:!&|?;]\s*$|^\s*$|return\s*$/.test(line.slice(0, i))) {
      // 正規表現リテラルらしいものは飛ばす
      let j = i + 1;
      while (j < line.length && line[j] !== '/') { if (line[j] === '\\') j++; j++; }
      for (let k = i; k <= j && k < line.length; k++) mask[k] = true;
      i = j;
    }
  }
  return mask;
}

function isCommentLine(t) { return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); }

function matchingParen(line, open) {
  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function balanced(s) {
  let d = 0;
  for (const c of s) {
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    if (d < 0) return false;
  }
  return d === 0;
}

/** ファイルの全変異候補を作る。{ id, file, line, op, from, to } */
function generateMutants(rel, src) {
  const lines = src.split('\n');
  const out = [];
  const add = (ln, op, newLine) => {
    if (newLine === lines[ln]) return;
    out.push({ id: rel + ':' + (ln + 1) + ':' + op + ':' + out.length, file: rel, line: ln + 1, op,
      from: lines[ln], to: newLine });
  };
  let inBlockComment = false;
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const t = line.trim();
    if (inBlockComment) { if (t.includes('*/')) inBlockComment = false; continue; }
    if (t.startsWith('/*') && !t.includes('*/')) { inBlockComment = true; continue; }
    if (!t || isCommentLine(t)) continue;
    const mask = codeMask(line);
    const at = (i, len) => { for (let k = i; k < i + len; k++) if (mask[k]) return false; return true; };
    const swap = (i, len, rep) => line.slice(0, i) + rep + line.slice(i + len);
    // 演算子
    const ops = [
      [/===/g, '!==', 'eq'], [/!==/g, '===', 'neq'],
      [/(?<![=!<>])==(?!=)/g, '!=', 'eq2'], [/!=(?!=)/g, '==', 'neq2'],
      [/<=/g, '<', 'le'], [/(?<![<=])<(?![<=])/g, '<=', 'lt'],
      [/>=/g, '>', 'ge'], [/(?<![>=])>(?![>=])/g, '>=', 'gt'],
      [/&&/g, '||', 'and'], [/\|\|/g, '&&', 'or'],
      [/\btrue\b/g, 'false', 'true'], [/\bfalse\b/g, 'true', 'false'],
      [/\+ 1\b/g, '+ 0', 'plus1'], [/- 1\b/g, '- 0', 'minus1'],
    ];
    for (const [re, rep, op] of ops) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        if (!at(m.index, m[0].length)) continue;
        add(ln, op, swap(m.index, m[0].length, rep));
      }
    }
    // 比較相手の文字列リテラル
    const strRe = /(===|!==)\s*'([^'\\]*)'/g;
    let sm;
    while ((sm = strRe.exec(line))) {
      if (!at(sm.index, 3)) continue;
      const start = sm.index + sm[0].indexOf('\'');
      add(ln, 'str', line.slice(0, start) + '\'' + sm[2] + '__M\'' + line.slice(start + sm[2].length + 2));
    }
    // if 条件の否定 / 早期 return の無効化
    const ifRe = /\bif \(/g;
    let im;
    while ((im = ifRe.exec(line))) {
      if (!at(im.index, 2)) continue;
      const open = im.index + 3;
      const close = matchingParen(line, open);
      if (close < 0) continue;
      const cond = line.slice(open + 1, close);
      add(ln, 'ifneg', line.slice(0, open + 1) + '!(' + cond + ')' + line.slice(close));
      if (/^\s*return\b/.test(line.slice(close + 1))) {
        add(ln, 'noret', line.slice(0, open + 1) + 'false' + line.slice(close));
      }
    }
    // 1文の削除（関数の中・1行で完結する文・宣言と return 以外）
    const prev = (() => { for (let k = ln - 1; k >= 0; k--) { const p = lines[k].trim(); if (p && !isCommentLine(p)) return p; } return ''; })();
    if (/^\s{2,}/.test(line) && t.endsWith(';') && balanced(t) &&
        !/^(const|let|var|return|function|module\.exports)\b/.test(t) && !t.startsWith('}') &&
        (/[;{}]$/.test(prev) || prev === '')) {
      add(ln, 'del', line.replace(t, '/* deleted */'));
    }
  }
  return out;
}

function validSyntax(rel, src) {
  try {
    // publish.js 等の CommonJS もラップすれば通る。gas の top-level 文も通る。
    // 先頭の shebang（#!）は関数の中では構文エラーになるので、行コメントに置き換えてから調べる。
    const body = src.replace(/^#!/, '//');
    new vm.Script('(function(require,module,exports,__dirname,__filename){' + body + '\n})', { filename: rel });
    return true;
  } catch (e) { return false; }
}

function applyMutant(src, m) {
  const lines = src.split('\n');
  if (lines[m.line - 1] !== m.from) throw new Error('stale mutant ' + m.id);
  lines[m.line - 1] = m.to;
  return lines.join('\n');
}

/** 対象ごとの関連テスト。 */
/** npm test と同じ集合（gas/tests/*.test.js）。baseline のときは自分の殺しテストを外す。 */
function allTests(baseline) {
  return fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js') && !(baseline && f.startsWith('bughunt2_M_')))
    .sort().map((f) => path.join('gas', 'tests', f));
}

function relevantTests(rel, baseline, withSlow) {
  const base = path.basename(rel, '.js');
  const files = fs.readdirSync(TEST_DIR);
  const helpers = files.filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const text = {};
  files.filter((f) => f.endsWith('.js')).forEach((f) => { text[f] = fs.readFileSync(path.join(TEST_DIR, f), 'utf8'); });
  const touches = (f, seen = new Set()) => {
    if (seen.has(f)) return false;
    seen.add(f);
    const s = text[f];
    if (s.includes(base)) return true;
    if (rel.startsWith('gas/') && (/readdirSync\(\s*GAS_DIR|readdirSync\(.*gas/.test(s) || s.includes('readdirSync(GAS'))) return true;
    return helpers.some((h) => s.includes(h.replace(/\.js$/, '')) && touches(h, seen));
  };
  return files.filter((f) => f.endsWith('.test.js') && (withSlow || !SLOW_TESTS.includes(f)) && !(baseline && f.startsWith('bughunt2_M_')) &&
    touches(f)).map((f) => path.join('gas', 'tests', f));
}

function copyRepo(dest) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const r = path.relative(ROOT, src);
      return !(r === '.git' || r.startsWith('.git' + path.sep) || r.split(path.sep).includes('node_modules') ||
        r.startsWith(path.join('.claude', 'worktrees')));
    },
  });
}

function runTests(cwd, tests, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=2', ...tests],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ status: 'timeout' }); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const failing = (out.match(/^not ok \d+ - .*$/gm) || []).slice(0, 3);
      resolve({ status: code === 0 ? 'survived' : 'killed', failing });
    });
  });
}

async function main() {
  const o = parseArgs(process.argv);
  const rng = mulberry32(o.seed);
  let mutants = [];
  const stats = {};
  for (const rel of o.targets) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    let all = generateMutants(rel, src).filter((m) => validSyntax(rel, applyMutant(src, m)));
    // 決まった種で並べ替えて上限まで取る
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    const cap = o.cap[path.basename(rel)] || o.cap.default;
    stats[rel] = { candidates: all.length };
    all = all.slice(0, cap);
    mutants = mutants.concat(all);
  }
  if (o.idsFrom) {
    const prev = JSON.parse(fs.readFileSync(o.idsFrom, 'utf8'));
    const want = new Set(prev.results.filter((r) => r.status === 'survived' || r.status === 'timeout').map((r) => r.id));
    mutants = mutants.filter((m) => want.has(m.id));
  }
  const testsFor = {};
  o.targets.forEach((rel) => { testsFor[rel] = o.full ? allTests(o.baseline) : relevantTests(rel, o.baseline, o.withSlow); });
  console.error('mutants:', mutants.length, JSON.stringify(stats));

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bh2m-'));
  const cleanup = () => { try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => { cleanup(); process.exit(130); }));
  const logPath = o.out ? o.out + '.jsonl' : null;
  if (logPath) fs.writeFileSync(logPath, '');
  const workers = [];
  for (let w = 0; w < o.workers; w++) {
    const d = path.join(tmpBase, 'w' + w);
    copyRepo(d);
    workers.push(d);
  }
  const results = [];
  let next = 0;
  const started = Date.now();
  async function work(dir) {
    while (next < mutants.length) {
      const m = mutants[next++];
      const file = path.join(dir, m.file);
      const orig = fs.readFileSync(file, 'utf8');
      let r;
      try {
        fs.writeFileSync(file, applyMutant(orig, m));
        r = await runTests(dir, testsFor[m.file], o.timeoutMs);
        if (r.status === 'survived' && o.confirm) {
          const full = await runTests(dir, allTests(o.baseline), o.timeoutMs * 2);
          r = { status: full.status, failing: full.failing, confirmedFull: true };
        }
      } finally {
        fs.writeFileSync(file, orig);
      }
      results.push(Object.assign({}, m, r));
      if (logPath) fs.appendFileSync(logPath, JSON.stringify(Object.assign({}, m, r)) + '\n');
      process.stderr.write(`[${results.length}/${mutants.length}] ${r.status} ${m.id}\n`);
    }
  }
  try {
    await Promise.all(workers.map(work));
  } finally {
    cleanup();
  }
  results.sort((a, b) => (a.file + String(a.line).padStart(5, '0')).localeCompare(b.file + String(b.line).padStart(5, '0')));
  const killed = results.filter((r) => r.status !== 'survived').length;
  const summary = { total: results.length, killed, survived: results.length - killed,
    score: results.length ? +(killed / results.length * 100).toFixed(1) : null,
    seconds: Math.round((Date.now() - started) / 1000), byFile: {} };
  results.forEach((r) => {
    const b = summary.byFile[r.file] || (summary.byFile[r.file] = { total: 0, survived: 0 });
    b.total++; if (r.status === 'survived') b.survived++;
  });
  const report = { summary, stats, results };
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  results.filter((r) => r.status === 'survived').forEach((r) => {
    console.log(`SURVIVED ${r.id}\n  - ${r.from.trim()}\n  + ${r.to.trim()}`);
  });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { generateMutants, codeMask, relevantTests, allTests };
