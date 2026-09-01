/**
 * CSV / オブジェクト変換。GAS API に依存しない純関数。
 */

/** RFC4180 準拠で CSV を2次元配列に分解する。 */
function parseCsv(text) {
  if (!text) return [];
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

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
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
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

/** 1行目をヘッダとして各行をオブジェクトにする。 */
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map(function (r) {
    const obj = {};
    header.forEach(function (key, idx) { obj[key] = idx < r.length ? r[idx] : ''; });
    return obj;
  });
}

if (typeof module !== 'undefined') { module.exports = { parseCsv, csvToObjects }; }
