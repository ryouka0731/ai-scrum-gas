const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENT_EDITABLE_FIELDS, validateImpedimentFields, validateResolution } =
  require('../pure_impediment_validate.js');

test('編集できる列は4つだけ（id / 日付 / status / 解決の列は含まない）', () => {
  assert.deepEqual(IMPEDIMENT_EDITABLE_FIELDS, ['title', 'description', 'reported_by', 'sprint']);
});

test('タイトルと報告者が揃えば通る', () => {
  assert.deepEqual(validateImpedimentFields({ title: 'A', reported_by: 'マヤ' }), { ok: true, errors: [] });
});

test('空白だけのタイトル・報告者は、両方の誤りを一度に返す', () => {
  const r = validateImpedimentFields({ title: '  ', reported_by: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['タイトルを入力してください。', '報告者を入力してください。']);
});

test('fields が無くても落ちない', () => {
  assert.equal(validateImpedimentFields(null).ok, false);
});

test('解決策は空白だけでは通らない', () => {
  assert.equal(validateResolution('  ').ok, false);
  assert.deepEqual(validateResolution('  ').errors, ['解決策を入力してください。']);
  assert.equal(validateResolution(null).ok, false);
  assert.equal(validateResolution('再起動した').ok, true);
});

test('（）だけで囲んだタイトルは雛形の行と見分けられないので拒否する（前後の空白は無視）', () => {
  const msg = 'タイトルを（）だけで囲まないでください。雛形の行と見分けられなくなります。';
  assert.deepEqual(validateImpedimentFields({ title: ' （サーバ停止） ', reported_by: 'マヤ' }), { ok: false, errors: [msg] });
  assert.deepEqual(validateImpedimentFields({ title: '（）', reported_by: 'マヤ' }).errors, [msg]);
  assert.equal(validateImpedimentFields({ title: '（仮）サーバ停止', reported_by: 'マヤ' }).ok, true);
  assert.equal(validateImpedimentFields({ title: 'サーバ停止（本番）', reported_by: 'マヤ' }).ok, true);
});

test('GAS の共有グローバルに汎用名 blank_ を置かない', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'pure_impediment_validate.js'), 'utf8');
  assert.doesNotMatch(src, /function blank_\(/);
});
