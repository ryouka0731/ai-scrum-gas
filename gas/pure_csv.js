/**
 * CSV / オブジェクト変換。GAS API に依存しない純関数。
 */

/**
 * RFC4180 準拠で CSV を2次元配列に分解する。
 *
 * 引用符で始まらないフィールドの途中にある " は、ただの文字として読む（寛容な読み方）。
 * 手で書いた「5" モニタ」のようなタイトルで引用が始まると、以降の行がファイル末尾まで
 * 1つのセルに飲み込まれ、書き戻しでそれらの行が失われるため。
 */
function parseCsv(text) {
  return parseCsvWithLines_(text).rows;
}

/** parseCsv と同じ。各行が始まるファイル上の行番号（1始まり）も lines に返す。 */
function parseCsvWithLines_(text) {
  if (!text) return { rows: [], lines: [] };
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;
  let line = 1;
  let rowStart = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; continue; }
    if (ch === ',') { row.push(field); field = ''; atFieldStart = true; continue; }
    if (ch === '\n') {
      row.push(field); rows.push(row); lines.push(rowStart);
      row = []; field = ''; atFieldStart = true; rowStart = line; continue;
    }
    field += ch;
    atFieldStart = false;
  }
  row.push(field);
  rows.push(row);
  lines.push(rowStart);

  // 末尾の空行（空セル1個だけの行）を落とす
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') { rows.pop(); lines.pop(); } else break;
  }
  return { rows: rows, lines: lines };
}

/**
 * 見出しよりセルが多く、余ったセルに中身（trim して空でない値）があるデータ行のうち
 * 最初のものを返す（無ければ null）。{ id: 1列目の値（trim）, line: ファイル上の行番号, cells, expected }
 * そのまま書き戻すと、見出しに無いセルが黙って消える（csvToObjects は見出しの列だけを拾う）。
 * 余ったセルが空だけなら失うものは無いので見逃す（書き戻しで末尾の空セルが落ちるだけ）。
 */
function findOverlongCsvRow(text) {
  return overlongInParsed_(parseCsvWithLines_(text));
}

function overlongInParsed_(parsed) {
  if (parsed.rows.length < 2) return null;
  const expected = parsed.rows[0].length;
  for (let i = 1; i < parsed.rows.length; i++) {
    const r = parsed.rows[i];
    const extraFilled = r.slice(expected).some(function (c) { return String(c).trim() !== ''; });
    if (extraFilled) return { id: String(r[0]).trim(), line: parsed.lines[i], cells: r.length, expected: expected };
  }
  return null;
}

/** 空行か（区切りの無い、空セル1個だけの行）。 */
function isBlankCsvRow_(r) {
  return r.length === 1 && r[0] === '';
}

/**
 * 1行目をヘッダとして各行をオブジェクトにする。
 *
 * 途中の空行はデータ行にしない（parseCsv が末尾の空行を落とすのと揃える）。残すと
 * 書き戻しで `,,,` の行として残り続ける。カンマだけの行（`,,,`）は書かれた内容として
 * 残す（toCsv が全列空の行をそう書くため、往復で行数を変えない）。
 * 1列だけの CSV では空の値と空行が区別できず、空の値の行は消える（既知の制約）。
 */
function csvToObjects(text) {
  return objectsFromCsvRows_(parseCsv(text));
}

function objectsFromCsvRows_(rows) {
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).filter(function (r) { return !isBlankCsvRow_(r); }).map(function (r) {
    const obj = {};
    header.forEach(function (key, idx) { obj[key] = idx < r.length ? r[idx] : ''; });
    return obj;
  });
}

/**
 * CSV の文字列が、閉じていない引用符の中で終わっているか（parseCsv と同じ読み方で）。
 * そうなら、末尾に行を足しても前のセルの続きとして飲み込まれる。
 */
function csvEndsInsideQuotes(text) {
  const src = String(text || '');
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') i++; else inQuotes = false;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; continue; }
    if (ch === ',' || ch === '\n' || ch === '\r') { atFieldStart = true; continue; }
    if (ch === '﻿' && i === 0) continue;
    atFieldStart = false;
  }
  return inQuotes;
}

/**
 * 書き戻しの前の読み取り。1回の解釈で、csvToObjects の行と findOverlongCsvRow の結果（無ければ null）を返す。
 * 別々に呼ぶとファイル全体を2回解釈する（書き込みはロックの中なので、その分だけ他の人を待たせる）。
 */
function csvToObjectsChecked(text) {
  const parsed = parseCsvWithLines_(text);
  return { rows: objectsFromCsvRows_(parsed.rows), overlong: overlongInParsed_(parsed) };
}

/**
 * 先頭のレコード（見出し）だけを parseCsv と同じ読み方で返す。無ければ []。
 * 見出しの検査のためにファイル全体を解釈しない（先頭の改行までを走査し、そこだけを解釈する）。
 * 引用の中の改行は見出しの続きとして扱う。
 */
function csvHeaderRow(text) {
  const src = String(text || '');
  let inQuotes = false;
  let atFieldStart = true;
  let end = src.length;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') i++; else inQuotes = false;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) { inQuotes = true; atFieldStart = false; continue; }
    if (ch === '\n' || ch === '\r') { end = i; break; }
    if (ch === ',') { atFieldStart = true; continue; }
    if (ch === '\ufeff' && i === 0) continue;
    atFieldStart = false;
  }
  return parseCsvWithLines_(src.slice(0, end)).rows[0] || [];
}

if (typeof module !== 'undefined') {
  module.exports = { parseCsv, csvToObjects, csvEndsInsideQuotes, findOverlongCsvRow, csvToObjectsChecked, csvHeaderRow };
}
