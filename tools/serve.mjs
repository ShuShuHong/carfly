/**
 * 特技飞天跑车 (Carfly)
 *
 * Copyright (c) 2026 ShuShuHong
 * Licensed under the MIT License.
 * See LICENSE file in the project root for full license information.
 *
 * This project uses Three.js (https://threejs.org/) under the MIT License.
 */
// 本地静态服务：node tools/serve.mjs [port]
// 首次运行若 lib/three.module.min.js 不存在，会从 npm 官方 CDN（unpkg）下载固定版本 three@0.170.0。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const THREE_VER = '0.170.0';
const THREE_FILE = path.join(ROOT, 'lib', 'three.module.min.js');

async function ensureThree() {
  if (fs.existsSync(THREE_FILE) && fs.statSync(THREE_FILE).size > 100000) return;
  const url = `https://unpkg.com/three@${THREE_VER}/build/three.module.min.js`;
  console.log(`[serve] downloading ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  fs.mkdirSync(path.dirname(THREE_FILE), { recursive: true });
  fs.writeFileSync(THREE_FILE, Buffer.from(await r.arrayBuffer()));
  console.log(`[serve] saved lib/three.module.min.js (${fs.statSync(THREE_FILE).size} bytes)`);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
};

try { await ensureThree(); } catch (e) { console.error('[serve] three.js 下载失败：', e.message); }

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }   // 防目录穿越
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[serve] http://localhost:${PORT}`));
