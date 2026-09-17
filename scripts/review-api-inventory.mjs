import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
}
const routes = (await files(path.join(root, 'app/api'))).filter(p => p.endsWith('route.ts')).sort();
const pages = (await files(path.join(root, 'app'))).filter(p => p.endsWith('page.tsx'));
const rows = [];
for (const file of routes) {
  const code = await readFile(file, 'utf8');
  const methods = [...code.matchAll(/export\s+(?:const|(?:async\s+)?function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(m => m[1]);
  rows.push({ route: '/' + path.relative(path.join(root, 'app'), path.dirname(file)).replaceAll('\\', '/'), methods });
}
await mkdir(path.join(root, 'docs/reviews'), { recursive: true });
await writeFile(path.join(root, 'docs/reviews/api-inventory.md'),
  '# API 구현 목록\n\n소스에서 직접 export된 HTTP 핸들러 목록이다. 존재 여부만 나타내며 권한·업무 규칙·UI 연결의 완성을 보증하지 않는다.\n\n' +
  `페이지 ${pages.length}개, API route 파일 ${routes.length}개, 직접 export된 핸들러 ${rows.reduce((n,r)=>n+r.methods.length,0)}개.\n\n` +
  '| 경로 | 메서드 |\n|---|---|\n' + rows.map(r => `| \`${r.route}\` | ${r.methods.join(', ') || '별도 확인 필요'} |`).join('\n') + '\n');
console.log(JSON.stringify({ pages: pages.length, routes: routes.length, handlers: rows.reduce((n,r)=>n+r.methods.length,0) }));
