# 현재 재고 실사 기록

2026-10-02 기준으로 코드와 migration을 준비했다. **운영 DB에는 적용하지 않았다.** 기존 카카오톡 기록이나 세탁 내역을 재고로 자동 이전하지 않는다.

## 기록 의미

- 현재 재고는 숙소에 남아 있는 **깨끗한 실물 수량을 확인한 값**이다. 세탁 보냄·입고는 별도 기록이며 현재 재고를 자동 차감하거나 합산하지 않는다.
- 확인한 품목만 새 수량으로 대체한다. `0`은 실제 0개로 저장하고, 미기재 품목은 이전 수량과 확인 시각을 유지한다. 마지막 확인값이므로 이후 실제 재고와 다를 수 있다.
- 품목별 확인 시각과 확인자는 서버에서 기록한다. 한 번에 30개 품목, 숙소별 스냅샷 100개 품목까지 저장한다.
- 같은 요청 UUID와 동일한 계정·숙소·버전·품목 내용으로 재시도하면 원 저장 결과를 반환한다. 같은 UUID의 다른 내용이나 새 요청의 오래된 버전은 409이며 최신 값을 읽고 실제 수량을 다시 확인해야 한다.

## 운영 적용 순서

1. 운영 스키마와 migration 이력을 확인하고 백업한 뒤, `prisma/migrations/20261002010000_inventory_counts/migration.sql`을 검토한다. 신규 테이블 두 개와 인덱스, 불변 기록 트리거, 서버 전용 RLS를 추가한다.
2. 승인된 DB 배포 과정에서 해당 SQL을 전체 트랜잭션으로 적용한다. Prisma migration 배포를 사용한다면 기존 이력이 운영 스키마와 일치하는지 먼저 확인한다. `migrate deploy`는 **이 파일뿐 아니라 모든 미적용 migration을 실행**하므로 새 테이블 하나만 적용하는 명령으로 취급하지 않는다.
3. Prisma client를 생성하고 앱을 빌드·배포한다. 현재 `npm run build`에 client 생성이 포함되어 있다.
4. 활성 계정으로 담당 숙소를 선택해 조회와 실제 수량 저장을 확인한다. 다른 담당자의 동시 저장, 동일 요청 재시도, 권한 없는 숙소 접근도 점검한다. 실사 기록은 수정·삭제하지 않으며 정정은 새 실사로 남긴다.

`InventorySnapshot` / `inventory_snapshots`는 숙소별 최신 값을, `InventoryCountRecord` / `inventory_count_records`는 부분 확인 내용과 원 저장 결과를 보관한다. 감사 기록 INSERT가 실패하면 같은 트랜잭션의 스냅샷 변경도 롤백된다.

## 서버 DB 권한

Prisma migration 연결은 `DATABASE_URL`, 앱 실행 연결은 `lib/prisma.ts`의 `DB_USER` 등 DB 설정을 사용한다. 서로 다른 역할을 쓰는 경우 새 테이블에 대한 **앱 실행 역할의 접근**도 확인해야 한다.

- 스냅샷: 서버 실행 역할의 SELECT·INSERT·UPDATE가 필요하다.
- 실사 기록: 서버 실행 역할의 SELECT·INSERT가 필요하다. UPDATE·DELETE는 불변 트리거가 거부한다.
- RLS는 두 테이블 모두 활성화된다. 테이블 소유 역할 등 승인된 서버 역할로 실행하거나 해당 서버 역할에만 허용되는 접근 정책을 별도 배포 과정에서 설정해야 한다. 서버 역할의 함수 실행·스키마 접근 권한도 확인한다.
- `PUBLIC`, Supabase `anon`, `authenticated`에는 테이블 권한을 제공하지 않는다. 브라우저의 Supabase 직접 조회·쓰기를 열어 해결하지 않는다. 앱의 인증·담당 숙소 검사는 `/api/inventory`에서 수행한다.

새 재고 테이블이 없으면 조회는 숙소 목록과 `available:false`를 반환하고 저장은 503으로 거부한다. 연결 실패·권한 부족·다른 스키마 오류는 일반 오류로 처리하며 저장 성공으로 표시하지 않는다.

## 안전한 개발 미리보기와 검증

개발 서버에서 `/admin/inventory/preview` 또는 `/cleaner/records/preview`를 연다. 미리보기는 가상 자료를 사용하며 실제 기록을 저장하지 않는다. 두 경로는 `NODE_ENV=development`에서만 열리고 운영 빌드에서는 404다. 일반 `/admin/inventory`, `/cleaner/records`는 실제 API를 사용하므로 화면 확인용으로 운영 재고를 저장하지 않는다.

다음 테스트는 외부 DB에 접속하지 않는다. DB 검증은 로컬 PGlite에서 migration, RLS, 기록 불변성, 트랜잭션 롤백을 확인한다.

```text
node --experimental-strip-types --no-warnings --import ./tests/register.mjs --test tests/inventory.test.ts tests/inventory-database.test.ts
```
