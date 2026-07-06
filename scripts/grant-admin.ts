// 단일 사용자에게 admin 권한 부여.
//
// 사용법:
//   npx tsx scripts/grant-admin.ts <email> [password]
//
// 동작:
//   • 이메일이 이미 있으면 → role='admin', status='active' 로 업데이트.
//     password 인자가 주어지면 비밀번호도 함께 재설정.
//   • 없으면 → 새 유저 생성. password 인자 없으면 랜덤 12자 발급.
//
// 보안: 비밀번호는 콘솔 출력 1회만, DB 에는 bcrypt 해시만 저장.

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

function randomPassword(length = 12): string {
  // base64url 에서 영숫자만 추출
  return randomBytes(32).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, length);
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const explicitPassword = (process.argv[3] || '').trim();
  if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    console.error('Usage: npx tsx scripts/grant-admin.ts <email> [password]');
    process.exit(1);
  }

  const { prisma } = await import('../lib/prisma.js');

  const existing = await prisma.user.findUnique({ where: { email } });

  // 비밀번호 결정 — explicit 가 있으면 그것, 신규에 explicit 없으면 랜덤, 기존에 explicit 없으면 변경 안 함
  const passwordToSet = explicitPassword || (existing ? null : randomPassword(12));
  const hashed = passwordToSet ? await bcrypt.hash(passwordToSet, 12) : null;

  if (existing) {
    const data: Record<string, unknown> = { role: 'admin', status: 'active' };
    if (hashed) data.password = hashed;
    const updated = await prisma.user.update({
      where: { email },
      data,
      select: { id: true, email: true, role: true, status: true, displayName: true },
    });
    console.log('');
    console.log('✓ 기존 유저 권한 업데이트됨');
    console.log('  email:', updated.email);
    console.log('  role:', updated.role);
    console.log('  status:', updated.status);
    console.log('  displayName:', updated.displayName ?? '(none)');
    if (passwordToSet) {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('비밀번호 재설정됨:', passwordToSet);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      console.log('비밀번호는 변경되지 않았습니다.');
    }
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        password: hashed!,
        role: 'admin',
        status: 'active',
      },
      select: { id: true, email: true, role: true, status: true },
    });
    console.log('');
    console.log('✓ 신규 유저 생성됨');
    console.log('  email:', created.email);
    console.log('  role:', created.role);
    console.log('  status:', created.status);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('비밀번호:', passwordToSet);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('안전한 채널로 사용자에게 전달하세요. 사용자는 첫 로그인 후 본인 설정 페이지에서 변경 권장.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
