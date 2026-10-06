/**
 * 自動同期の頻度の上限。GAS API に依存しない純関数。
 *
 * トリガーのハンドラ（scheduledSync）は google.script.run からも呼べてしまう（全グローバル関数が
 * ブラウザへ公開されるため）。連打されると全シートの再構築とスクリプトロックの占有を繰り返し、
 * 他の人の書き込みが 'busy' になる。前回の成功から一定時間内なら同期しない。
 * 正規のトリガーは30分毎なので、この上限には掛からない。
 */

const SCHEDULED_SYNC_MIN_INTERVAL_MS = 60000;

/**
 * 前回の成功（記録した Date.now() の文字列）から上限の時間がたっていなければ true。
 * 記録が無い・数字でない・未来（時計のずれ等）のときは false（同期する。止まり続けない側に倒す）。
 */
function isSyncTooSoon(lastText, nowMs) {
  const text = String(lastText === undefined || lastText === null ? '' : lastText).trim();
  if (!/^\d+$/.test(text)) return false;
  const last = Number(text);
  if (!isFinite(last) || last > nowMs) return false;
  return nowMs - last < SCHEDULED_SYNC_MIN_INTERVAL_MS;
}

if (typeof module !== 'undefined') {
  module.exports = { SCHEDULED_SYNC_MIN_INTERVAL_MS, isSyncTooSoon };
}
