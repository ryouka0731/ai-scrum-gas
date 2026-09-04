const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeCsvCell, toCsv } = require('../pure_csv_write.js');
const { csvToObjects } = require('../pure_csv.js');

test('特殊文字が無ければ引用しない', () => {
  assert.equal(escapeCsvCell('ログイン'), 'ログイン');
});

test('カンマを含む値を引用する', () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
});

test('改行を含む値を引用する', () => {
  assert.equal(escapeCsvCell('a\nb'), '"a\nb"');
});

test('引用符を二重にして囲む', () => {
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
});

test('undefined と null は空文字にする', () => {
  assert.equal(escapeCsvCell(undefined), '');
  assert.equal(escapeCsvCell(null), '');
});

test('数値を文字列にする', () => {
  assert.equal(escapeCsvCell(5), '5');
});

test('真偽値やオブジェクトを String() で文字列化する', () => {
  assert.equal(escapeCsvCell(true), 'true');
  assert.equal(escapeCsvCell({ a: 1 }), '[object Object]');
});

test('CRLF を LF に正規化して引用符で囲む（parseCsv の正規化と対称にする）', () => {
  assert.equal(escapeCsvCell('line1\r\nline2'), '"line1\nline2"');
});

test('見出し行と値の行を出す', () => {
  const rows = [{ id: 'PBI-001', title: 'ログイン' }];
  assert.equal(toCsv(rows, ['id', 'title']), 'id,title\nPBI-001,ログイン\n');
});

test('fields の順に列を並べる', () => {
  const rows = [{ b: '2', a: '1' }];
  assert.equal(toCsv(rows, ['a', 'b']), 'a,b\n1,2\n');
});

test('fields に無いキーを出さない', () => {
  const rows = [{ a: '1', extra: 'x' }];
  assert.equal(toCsv(rows, ['a']), 'a\n1\n');
});

test('fields にあるキーが行に無ければ空文字にする', () => {
  const rows = [{ a: '1' }];
  assert.equal(toCsv(rows, ['a', 'b']), 'a,b\n1,\n');
});

test('行が無ければ見出し行だけ出す', () => {
  assert.equal(toCsv([], ['a', 'b']), 'a,b\n');
});

test('rows が null / undefined でも見出し行だけ出す', () => {
  assert.equal(toCsv(null, ['a', 'b']), 'a,b\n');
  assert.equal(toCsv(undefined, ['a', 'b']), 'a,b\n');
});

test('書き出して読み直すと同じ値になる', () => {
  const rows = [
    { id: 'PBI-001', title: 'a,b', note: 'say "hi"' },
    { id: 'PBI-002', title: '1\n2', note: '' },
  ];
  const fields = ['id', 'title', 'note'];
  assert.deepEqual(csvToObjects(toCsv(rows, fields)), rows);
});

test('セル内に CRLF が入っていても書き出して読み直すと LF で一致する', () => {
  const rows = [{ id: 'PBI-001', note: 'line1\r\nline2' }];
  const fields = ['id', 'note'];
  // parseCsv 側が読み取り時に CRLF を LF へ正規化するため、往復後は LF になる
  const expected = [{ id: 'PBI-001', note: 'line1\nline2' }];
  assert.deepEqual(csvToObjects(toCsv(rows, fields)), expected);
});
