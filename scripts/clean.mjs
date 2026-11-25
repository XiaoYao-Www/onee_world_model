/** 建置前清掉舊的雜湊資產，避免 root 目錄累積過期檔案。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['assets']) {
  const target = path.join(root, dir);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}
