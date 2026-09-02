/**
 * Markdown から表とセクション本文を取り出す。GAS API に依存しない純関数。
 * 行番号ではなく見出しテキストを起点にすることで、成果物の編集に追従できるようにする。
 */

/** 見出し行（# の数は問わない）にマッチし、その見出しテキストを返す。 */
function headingTextOf(line) {
  const m = String(line).match(/^#{1,6}\s+(.*?)\s*$/);
  return m ? m[1] : null;
}

/** 表の1行を解析してセル配列にする。セル内の `\|` はエスケープされたパイプとして扱う。 */
function splitTableRow(line) {
  // 半角スペース等は通常のセル内容（例: "Sprint 001"）で普通に使われるため、
  // 退避先には表の内容として現れない制御文字を使う。
  const PLACEHOLDER = '\u0000';
  return String(line)
    .replace(/\\\|/g, PLACEHOLDER)
    .replace(/^\s*\|/, '').replace(/\|\s*$/, '')
    .split('|')
    .map(function (c) { return c.split(PLACEHOLDER).join('|').trim(); });
}

/** 区切り行（|---|---|）かどうか。 */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.indexOf('-') !== -1;
}

/** 指定見出しから次の見出しまでの行を返す。同名の見出しが複数ある場合は最初の一致を採用する。 */
function linesUnderHeading(text, heading) {
  const lines = String(text || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingTextOf(lines[i]) === heading) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (headingTextOf(lines[i]) !== null) break;
    out.push(lines[i]);
  }
  return out;
}

/** 指定見出しのセクション内にある表を返す。無ければ null。 */
function extractMarkdownTable(text, heading) {
  const lines = linesUnderHeading(text, heading);
  if (!lines) return null;
  const tableLines = lines.filter(function (l) { return l.trim().indexOf('|') === 0; });
  if (tableLines.length < 2) return null;
  const headers = splitTableRow(tableLines[0]);
  const rows = [];
  for (let i = 1; i < tableLines.length; i++) {
    if (isSeparatorRow(tableLines[i])) continue;
    rows.push(splitTableRow(tableLines[i]));
  }
  return { headers: headers, rows: rows };
}

/**
 * 指定見出し直下の本文を返す。無ければ空文字。
 * 表（`|` 始まり）と引用（`>` 始まり）は落とす。成果物のひな形はスプリントゴールの直下に
 * スクラムガイドの引用を置いており、そのままだとダッシュボードのゴール欄に混入するため。
 */
function extractSection(text, heading) {
  const lines = linesUnderHeading(text, heading);
  if (!lines) return '';
  return lines
    .filter(function (l) {
      const t = l.trim();
      if (t === '') return false;
      if (t.indexOf('|') === 0) return false;
      if (t.indexOf('>') === 0) return false;
      return true;
    })
    .join('\n').trim();
}

if (typeof module !== 'undefined') {
  module.exports = { extractMarkdownTable, extractSection };
}
