/** 建置前清掉舊的雜湊資產，避免倉庫根目錄累積過期檔案。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rmForce(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
    return;
  } catch {
    /* 某些環境（含正在預覽的伺服器）會回 ENOTEMPTY，改逐一刪除 */
  }
  if (!fs.existsSync(target)) return;
  for (const entry of fs.readdirSync(target)) {
    const child = path.join(target, entry);
    try {
      if (fs.lstatSync(child).isDirectory()) rmForce(child);
      else fs.rmSync(child, { force: true });
    } catch {
      /* 略過被執行中程序（例如預覽伺服器）持有的檔案；下次建置會再清 */
    }
  }
  try {
    fs.rmdirSync(target);
  } catch {
    /* overlayfs/fuse 可能暫時無法移除目錄，保留空目錄即可 */
  }
}

for (const dir of ['assets']) {
  const target = path.join(root, dir);
  if (fs.existsSync(target)) rmForce(target);
}
