#!/usr/bin/env node
'use strict';

// 乱択のモデル試験を多くの種で回す（npm run test:stress）。
// BUGHUNT_STRESS=1 を Node から渡して node --test を起動する。シェルの `VAR=1 cmd` は
// Windows の cmd / PowerShell では動かないため、ここで包む（依存は増やさない）。

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FILES = [path.join(__dirname, '..', 'gas', 'tests', 'bughunt_c_model.test.js')];

const result = spawnSync(process.execPath, ['--test'].concat(FILES), {
  stdio: 'inherit',
  env: Object.assign({}, process.env, { BUGHUNT_STRESS: '1' }),
});
if (result.error) {
  console.error('node --test を起動できませんでした: ' + result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
