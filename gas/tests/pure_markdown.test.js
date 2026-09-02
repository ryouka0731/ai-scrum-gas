const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMarkdownTable, extractSection } = require('../pure_markdown.js');

const MD = [
  '# スプリントバックログ - Sprint 001',
  '',
  '## スプリントゴール',
  '',
  'ログイン機能を使える状態にする。',
  '',
  '## スプリント情報',
  '| 項目 | 内容 |',
  '|------|------|',
  '| スプリント番号 | Sprint 001 |',
  '| 開始日 | 2026-09-08 |',
  '',
  '## バーンダウン',
  '| 日付 | 残タスク数 | 残ポイント |',
  '|------|------------|------------|',
  '| Day 1 | 8 | 21 |',
  '| Day 2 | 6 | 18 |',
  '',
  '## 次の見出し',
].join('\n');

test('見出し直下の表を抽出する', () => {
  const t = extractMarkdownTable(MD, 'バーンダウン');
  assert.deepEqual(t.headers, ['日付', '残タスク数', '残ポイント']);
  assert.deepEqual(t.rows, [['Day 1', '8', '21'], ['Day 2', '6', '18']]);
});

test('区切り行を行として扱わない', () => {
  const t = extractMarkdownTable(MD, 'スプリント情報');
  assert.deepEqual(t.rows, [['スプリント番号', 'Sprint 001'], ['開始日', '2026-09-08']]);
});

test('表が無い見出しでは null を返す', () => {
  assert.equal(extractMarkdownTable(MD, 'スプリントゴール'), null);
});

test('存在しない見出しでは null を返す', () => {
  assert.equal(extractMarkdownTable(MD, '存在しない'), null);
});

test('見出し直下の本文を抽出する', () => {
  assert.equal(extractSection(MD, 'スプリントゴール'), 'ログイン機能を使える状態にする。');
});

test('存在しない見出しでは空文字を返す', () => {
  assert.equal(extractSection(MD, '存在しない'), '');
});

test('空文字を渡しても壊れない', () => {
  assert.equal(extractMarkdownTable('', 'x'), null);
  assert.equal(extractSection('', 'x'), '');
});

test('セル内のエスケープされたパイプ（\\|）を分割せず復元する', () => {
  const md = [
    '## 表',
    '| a | b |',
    '|---|---|',
    '| x\\|y | z |',
  ].join('\n');
  const t = extractMarkdownTable(md, '表');
  assert.deepEqual(t.rows, [['x|y', 'z']]);
});

test('スプリントゴールの直下にある引用（スクラムガイド）は落とす', () => {
  const md = [
    '# スプリントバックログ - Sprint 001',
    '',
    '## スプリントゴール',
    'タスク登録を最短手数で終わらせる',
    '',
    '> スプリントゴールはスプリントの単一の目的である。',
    '> — スクラムガイド 2020',
    '',
    '## スプリント情報',
    '| 項目 | 内容 |',
  ].join('\n');
  assert.equal(extractSection(md, 'スプリントゴール'), 'タスク登録を最短手数で終わらせる');
});

test('引用が字下げされていても落とす', () => {
  const md = '## ゴール\n本文\n  > 引用\n';
  assert.equal(extractSection(md, 'ゴール'), '本文');
});

