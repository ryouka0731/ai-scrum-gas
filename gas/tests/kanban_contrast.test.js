const test = require('node:test');
const assert = require('node:assert/strict');
const { styleSource, styleRules, topLevelRules, declarations } = require('./kanban_harness.js');

/** ルール本文の宣言を { プロパティ: 値 } に変換する。 */
function tokensFrom(rule) {
  const out = {};
  declarations(rule.body).forEach(function (d) { out[d.property] = d.value; });
  return out;
}

/** ライトの :root トークンを返す。 */
function lightTokens() {
  const root = topLevelRules(styleSource()).find(function (r) { return r.selector === ':root'; });
  return tokensFrom(root);
}

/**
 * ダークの :root トークンを返す。
 *
 * ライトとダークはどちらも同じセレクタ `:root` を使い、ダークは
 * `@media (prefers-color-scheme: dark) { :root { ... } }` で上書きする
 * （data-theme 属性で切り分けていない）。styleSource() から直接 indexOf(':root')
 * するとライト側を先に拾ってしまうため、topLevelRules() で @media を1件の
 * 規則として切り出し、その中身をあらためて topLevelRules() する。
 */
function darkTokens() {
  const media = styleRules().find(function (r) {
    return r.selector.indexOf('@media (prefers-color-scheme: dark)') === 0;
  });
  const root = topLevelRules(media.body).find(function (r) { return r.selector === ':root'; });
  return Object.assign({}, lightTokens(), tokensFrom(root));
}

/** @param {string} hex @returns {number} 相対輝度 (WCAG 2.1) */
function luminance(hex) {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map(function (i) { return parseInt(v.substring(i, i + 2), 16) / 255; });
  const lin = rgb.map(function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** @returns {number} コントラスト比 */
function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const THEMES = [['ライト', lightTokens], ['ダーク', darkTokens]];

THEMES.forEach(function (entry) {
  const name = entry[0];
  const tokens = entry[1];

  test(name + ': 本文と補助テキストが --card / --bg の上で 4.5:1 以上ある', () => {
    const c = tokens();
    const pairs = [
      ['--ink', '--card'], ['--ink', '--bg'],
      ['--ink-2', '--card'], ['--ink-2', '--bg'],
      ['--ink-3', '--card'], ['--ink-3', '--bg'],
    ];
    pairs.forEach(function (pair) {
      const fg = pair[0], bg = pair[1];
      assert.ok(contrast(c[fg], c[bg]) >= 4.5,
        fg + ' on ' + bg + ' が 4.5:1 未満: ' + contrast(c[fg], c[bg]).toFixed(2));
    });
  });

  test(name + ': ボタン地と危険色が読める', () => {
    const c = tokens();
    assert.ok(contrast(c['--accent-ink'], c['--accent']) >= 4.5, '--accent-ink on --accent');
    assert.ok(contrast(c['--danger'], c['--card']) >= 4.5, '--danger on --card');
  });
});
