/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 运行验收自测并把输出挂在 http://localhost:<port>/ 上（便于在没有终端的环境里查看结果）
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 5174);
const run = () => {
  const r = spawnSync(process.execPath, ['tests/reference.test.mjs'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '') + (r.stderr || '') + `\nexit code: ${r.status}\n`;
};
console.log(run());
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(run());
}).listen(PORT, '127.0.0.1', () => console.log(`[tests] http://localhost:${PORT}`));
