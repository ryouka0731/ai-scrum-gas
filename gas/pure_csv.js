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
  if (!text) return [];
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
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
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; atFieldStart = true; continue; }
    field += ch;
    atFieldStart = false;
  }
  row.push(field);
  rows.push(row);

  // 末尾の空行（空セル1個だけの行）を落とす
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop(); else break;
  }
  return rows;
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
  const rows = parseCsv(text);
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

if (typeof module !== 'undefined') { module.exports = { parseCsv, csvToObjects, csvEndsInsideQuotes }; }
