# 파일·DB 정리 기록 — 2026-10-31

이번 정리는 현재 운영 코드와 복구 자료를 보존하면서 오래된 로컬 빌드 및 Git에 포함된 작업 산출물을 정리하는 작업이다. 예약·초대장·QR·객실 패드·인증·정기 작업은 계속 사용하는 기능으로 분류했다.

## 적용 상태

| 구분 | 상태 |
| --- | --- |
| 오래된 로컬 `.next-*` 빌드 폴더 29개 | 삭제 완료 |
| 빌드 산출물·작업 파일 318개 Git 추적 해제 | 제외 규칙과 함께 소스에 반영 |
| 기본 `.next` 및 `tmp/`, `output/` 실제 자료 | 보존 |
| 미사용 DB 테이블 5개 보관 마이그레이션·복원 SQL | 운영 DB 보관 적용 완료, 복원 SQL 제공 |
| DB 보관·복원 PGlite 테스트 | 12개 통과 |
| 전체 TypeScript 검사 | 통과 |
| 운영 DB 적용 | `va-postgres` / `hosting_manager_cutover_20261030`: `public` 99개 → 94개, 보관 스키마 5개 |

## 파일 정리 결과

작업 대상의 절대 경로가 `C:\voidproject\hosting-manager` 안에 있는지와 링크 여부를 확인한 뒤 오래된 `.next-*` 폴더 29개를 삭제했다. 삭제된 파일 크기의 합은 **12,648,075,310바이트, 약 11.78GiB**다. 기본 `.next`는 남겼다.

Git에서는 다음 파일을 추적 해제했다. `tmp/`, `output/`은 실제 파일을 삭제하지 않았다.

| 경로 | 파일 수 | 파일 크기 합계 | 실제 파일 처리 |
| --- | ---: | ---: | --- |
| `.next-menu-preview/` | 233 | 90,818,978바이트 | 오래된 빌드 폴더 삭제에 포함 |
| `tmp/` | 83 | 24,469,928바이트 | 로컬 보존 |
| `output/` | 2 | 117,424바이트 | 로컬 보존 |
| 합계 | **318** | **115,406,330바이트, 약 110.06MiB** | |

Git 추적 해제 용량에는 위에서 삭제한 빌드 일부가 포함되므로 두 용량을 더해 디스크 확보량으로 계산하지 않는다. 과거 Git 커밋의 객체는 그대로 남으며, 이 작업은 기존 Git 기록을 다시 쓰지 않는다.

- `.gitignore`에 루트 `/tmp/`, `/output/` 제외 규칙을 추가했다. 기존 `/.next-*/` 규칙은 유지한다.
- `tsconfig.json`에서 오래된 `.next-*` 미리보기 타입 경로를 제거하고 기본 `.next/types`를 유지했다.
- `next-env.d.ts`의 오래된 미리보기 타입 참조를 기본 생성 경로로 수정했다.
- 전체 추적 소스에서 `tmp/`, `output/` 의존성을 확인했다. 실행·빌드·테스트 진입점에는 의존성이 없었고, 문서의 과거 검증 자료 링크와 도구 설정만 남아 있었다.

삭제된 빌드는 해당 프로젝트의 빌드 명령으로 다시 생성한다. `tmp/`, `output/` 작업 자료는 로컬에 그대로 있으므로 복원이 필요하지 않다.

## DB 정리 결과

다음 5개 테이블을 삭제하지 않고 `public`에서 **`archive_20261031` 스키마**로 이동했다.

| 테이블 | 보관 대상으로 분류한 이유 |
| --- | --- |
| `legacy_cleaners` | 직원·청소 담당자 통합 이전 테이블 |
| `legacy_cleaner_properties` | 위 통합 이전 담당 숙소 연결 기록 |
| `staff_identity_users_before` | 직원 통합 이전 사용자 스냅샷 |
| `organization_pricing_policies` | 사업자 공통 방식에서 숙소별 `property_pricing_policies`로 전환된 이전 설정 |
| `rate_setup_checks` | 현재 화면·실행 코드에서 더 이상 참조하지 않는 사용 준비 검증 기록 |

보관 스키마에는 `PUBLIC` 접근 권한을 부여하지 않는다. 테이블의 소유자·기존 권한·RLS 정책·데이터·식별자를 유지하며, 이동 전후 테이블 식별자와 행 수를 검증한다. 기록 안에 직원 정보나 인증 관련 과거 값이 있을 수 있어 원문을 문서나 테스트 결과에 복사하지 않는다.

마이그레이션은 하나의 트랜잭션에서 실행하며, 예상하지 못한 외부 FK·뷰·함수·트리거·RLS 참조·상속·publication, 보관 스키마 충돌, 원본 누락 등을 발견하면 중단한다. 잠금 대기 제한은 3초, 명령 실행 제한은 30초다. 정적 소스 검색만으로 운영 DB 적용 완료나 안전성을 단정하지 않는다.

준비된 파일:

- 마이그레이션: `prisma/migrations/20261031210000_archive_retired_tables/migration.sql`
- 플랫폼의 동일 마이그레이션: `C:\voidproject\hosting-manager-platform\apps\api\prisma\migrations\20261031210000_archive_retired_tables\migration.sql`
- **복원 SQL:** `C:\voidproject\hosting-manager\scripts\db\restore-retired-tables-20261031.sql`
- 회귀 테스트: `tests/retired-tables-archive.test.ts`

복원 SQL은 마이그레이션 소유자 권한으로 실행한다. 보관된 5개 테이블을 원래 `public`으로 되돌리며, 대상 이름 충돌이나 원본 누락 시 전체 작업을 중단한다. 이동 전후 식별자와 행 수도 다시 확인한다. 이미 복원한 상태에서 재실행하거나 원래 이름으로 새 테이블을 만든 뒤 실행하지 않는다. 복원 후 마이그레이션 이력 및 서비스 상태는 실제 적용 방법에 맞춰 별도로 확인한다.

12개 PGlite 테스트에서는 비어 있는 테이블과 데이터가 있는 테이블의 보관·복원, 데이터·제약조건·권한·RLS 보존, 앱 역할의 보관 스키마 접근 차단, 예상 밖 의존성과 이름 충돌 시 원본 보존을 검증했다. 이는 운영 DB 접속·적용 검증과 구분된다.

## 이번에 보존한 자료와 코드

| 대상 | 보존 근거 |
| --- | --- |
| JPG 원본과 WebP 사진 | 82개 쌍의 JPG가 약 348MiB이지만 이미지 최적화 원본이며 DB·외부 URL 참조가 모두 확인된 것은 아님. `main_yard.jpg`는 현재 OG 이미지에 사용 |
| `tmp`의 QR 제작 자료와 `output` PDF | 객실에 배포한 QR 및 출력물의 원본·제작 근거. Git에서만 제외하고 로컬 자료 유지 |
| `hosting-manager-mobile` | `src`, `android`, `server` 등 상당수 소스가 Git 미추적 상태. 미추적 파일을 미사용 파일로 간주하거나 `git clean`으로 지우면 안 됨 |
| 객실 패드 프로젝트 | 사용 중인 별도 서비스. Netlify가 루트를 게시하고 오프라인 매니페스트가 사진·QR 파일을 참조 |
| 기존 `hosting-manager` 운영 코드 | GCP의 게스트 페이지·초대장·QR·인증·배경 작업 실행 경로. 새 관리자 플랫폼과 역할이 다름 |
| 이전 `hosting-manager-api`, `hosting-manager-web` | 모노레포 전환 문서에서 보존한 되돌리기용 저장소. 단순 중복으로 삭제하지 않음 |
| `staff_identity_map` | 사용자·이전 청소 담당자 ID 매핑을 보정·병합 스크립트에서 사용 |
| `staff_user_merge_archive` | 직원 병합 이력과 복원 근거이며 유지보수 스크립트 참조가 있음 |
| `welcomepad_property` 및 패드 관련 FK 대상 | 패드 채팅 스레드 FK의 대상이며 과거 마이그레이션에서도 보존한 테이블. 현재 채팅 사용량이 없다는 이유만으로 삭제하지 않음 |
| 마이그레이션 원본과 `_prisma_migrations` | 새 환경 구성 및 적용 이력 확인에 필요 |

## 검증 자료

로컬 점검 자료는 `C:\voidproject\tmp\cleanup-audit-20261031`에 보관한다.

- `verified-build-deletion.json`, `removed-build-directories.json`: 확인·삭제한 빌드 경로와 크기
- `untracked-from-git.json`: Git 추적 해제 파일 목록
- `legacy-file-audit.json`, `legacy-image-candidates.json`: 파일·사진 참조 조사
- `db-cleanup-assessment.json`, `db-code-references.json`: DB 참조 조사

실제 디스크의 파일 목록과 Git 추적 목록의 수는 다를 수 있다. Git 정리 수치는 작업 전 `HEAD` 목록을 기록한 `untracked-from-git.json`을 기준으로 한다.

운영 DB 적용 전후 카탈로그를 대조해 5개 테이블 OID·소유자·ACL·RLS·제약조건·정책·크기가 동일함을 확인했다. 행 수는 이동 트랜잭션 안에서 비교했다. 총 163,840바이트의 테이블은 그대로 보관하므로 DB 저장 공간을 줄인 작업은 아니다. 앱 계정의 보관 스키마 접근은 차단됐다. 기존 Supabase와 다른 프로젝트 DB는 변경하지 않았다.

적용한 SQL 원본 SHA-256은 `aabe6692e8ff3105a1e8a93c5d2a6fc7f93bad27be97a1dcd4c3b11e1fc4b354`이다. Cloud SQL import에서는 같은 트랜잭션에 해당 마이그레이션의 이력 기록을 추가했다. 개인 데이터가 없는 DDL 파일 한 개에만 임시 읽기 권한을 부여했고 실행 후 회수했다. 운영 검증 자료는 Cloud Shell의 `voidanchae-gcp-switch-20261028/cleanup-audit-20261031/archive-before.json`, `archive-after.json`에 보관했다.
