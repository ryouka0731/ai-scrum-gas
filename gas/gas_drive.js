/**
 * Drive からスクラム成果物を読む。読み取りのみを行う薄い層。
 */

/** プロジェクトフォルダ配下の scrum フォルダを返す。 */
function getScrumFolder() {
  const id = getFolderId();
  if (!id) {
    throw configError(
      'Drive フォルダが未設定です。メニュー「AI Scrum」→「設定」でフォルダ ID を登録してください。');
  }
  let root;
  try {
    root = DriveApp.getFolderById(id);
  } catch (e) {
    throw configError('フォルダ ID ' + id + ' にアクセスできません。ID と共有設定を確認してください。');
  }
  const it = root.getFoldersByName('scrum');
  if (!it.hasNext()) {
    throw configError('指定フォルダの直下に scrum フォルダがありません。');
  }
  return it.next();
}

/** フォルダ直下のファイル本文を返す。無ければ null。 */
function readTextFile(folder, name) {
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  return it.next().getBlob().getDataAsString('UTF-8');
}

/** sprint で始まるフォルダのうち名前順で最後のものを返す。無ければ null。 */
function findLatestSprintFolder(scrumFolder) {
  const names = [];
  const byName = {};
  const it = scrumFolder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.indexOf('sprint') === 0) { names.push(n); byName[n] = f; }
  }
  if (names.length === 0) return null;
  names.sort();
  return byName[names[names.length - 1]];
}
