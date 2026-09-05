// 테스트 전용 모듈 로더.
//  - '@/lib/prisma' 처럼 인프라에 닿는 모듈은 tests/stubs 로 바꿔치기한다.
//  - 그 밖의 '@/…' 별칭은 프로젝트 루트로, 확장자 없는 상대 경로는 .ts/.tsx 로 해결한다.
//  - 실제 TS 는 Node 의 내장 type stripping 이 처리한다 (--experimental-strip-types).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 스텁 매핑. 실제 구현을 테스트하고 싶으면 테스트에서 상대 경로로 직접 import 한다
// (예: import { notifyCleaningCancelled } from '../lib/notify').
const STUBS = {
  '@/lib/prisma': 'tests/stubs/prisma.ts',
  '@/lib/auth': 'tests/stubs/auth.ts',
  '@/lib/notify': 'tests/stubs/notify.ts',
  'next/server': 'tests/stubs/next-server.ts',
  'next/headers': 'tests/stubs/next-headers.ts',
};

function isFile(p) {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

function tryFile(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, 'index.ts')]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (STUBS[specifier]) {
    return { url: pathToFileURL(path.join(ROOT, STUBS[specifier])).href, shortCircuit: true };
  }
  if (specifier.startsWith('@/')) {
    const file = tryFile(path.join(ROOT, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!isFile(base)) {
      const file = tryFile(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
