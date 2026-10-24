# Railway 백엔드용 공유 DB 보완안

**적용 후 확인:** 사용자가 SQL을 실행했다고 알린 뒤 2026-10-05에 기존 DB를 별도로 읽기 전용 조회했다. 누락 테이블 7개와 투어 컬럼 2개, 일정 NULL 허용, RLS·권한 차단, 트리거 2개, 성공 이력 5개 추가를 확인했다. 성공 이력은 27개이며 이번 대상의 미적용 항목은 없다. 수정 SQL을 다시 실행할 필요는 없다. 이 문서의 아래 초기 점검 내용은 적용 전 기록이다.

2026-10-05. 기존 Supabase를 계속 사용한다는 사용자 확인에 따라, 기존 `hosting-manager` 연결 설정으로 DB 메타데이터를 읽기 전용 조회했다. Railway에 저장된 접속 정보 자체를 조회한 것은 아니다. 고객·예약 데이터 행을 읽거나 운영 DB를 변경하지 않았다.

현재 상태는 백엔드 배포와 별개로 DB 구조 보완이 필요하다. 새 DB 생성이나 데이터 이전은 필요하지 않다. migration 원본은 계속 `hosting-manager/prisma/migrations`로 유지한다.

## 적용 전 확인된 차이

| 기능 | 필요한 변경 | 원본 migration |
| --- | --- | --- |
| 직원 병합 이력 | `staff_merges` 추가 | `20260917010000_staff_merge_audit` |
| 투어 예약 문의 | `requested_date`, `requested_time` 추가 및 `schedule_id` NULL 허용 | `20260918010000_tour_booking_inquiries` |
| 재고 기록 | `inventory_snapshots`, `inventory_count_records` 추가 | `20261002010000_inventory_counts` |
| 중복 작업 방지·결과 보관 | `backend_commands` 추가 | `20261005010000_backend_commands` |
| 예약 처리·메모 | `backend_reservation_commands`, `backend_reservation_annotations`, `backend_guest_notes` 추가 | `20261005150000_reservation_workflows` |

총 7개 테이블과 투어 컬럼 2개가 없다. 투어의 `schedule_id`는 현재 NOT NULL이다. 위 5개 migration은 적용 이력에 없으며, 관련 기록 보존 함수·트리거도 없다. 원본과 API 저장소의 Prisma 관련 파일 44개는 동일하다.

현재 로컬 연결 역할은 RLS를 통과하고 선행 테이블에 조회·쓰기 권한을 가진다. Railway의 실제 DB 역할도 별도로 확인해야 한다. DB의 기본 테이블 권한은 `anon`, `authenticated`에도 TRUNCATE 등을 부여한다. 보완 SQL은 새 업무 테이블의 RLS를 활성화하고 이 역할들의 권한을 회수한다. 원본 직원 병합 migration에서 빠진 권한 회수도 함께 포함한다.

## 적용 이력의 별도 문제

- 로컬 migration은 42개이며 DB 성공 이력은 22개다. 이력상 미적용 20개 전체가 실제로 빠졌다는 뜻은 아니다. 사업자·사용자 권한 등 일부 구조는 이미 존재한다.
- 실패 상태인 migration은 없다.
- 다음 2개의 기존 성공 이력은 현재 파일과 체크섬이 다르다. 이번 보완으로 수정하거나 덮어쓰지 않는다: `20260510010000_calendar_perf_indexes`, `20260510020000_welcomepad_property_merge`.
- `guest_stay_devices.pairing_hash`는 소스에서는 필수지만 DB에서는 NULL을 허용한다. 기존 기기 데이터와 사용 경로 확인이 필요하므로 이번 보완에서 제약을 강화하지 않는다.

따라서 지금 `prisma migrate deploy` 전체 실행, `db push`, `migrate reset`으로 맞추지 않는다. 특히 이력상 미적용인 `users_staff_identity`에는 직원 데이터 병합·삭제가 포함되어 있다.

## 검토할 SQL과 적용 절차

[보완 SQL](./2026-10-05-backend-repair.sql)은 현재 확인된 상태 전용이다. 운영 반영 전 최신 백업 또는 복구 지점을 확인하고, 기존 서비스와 새 API를 함께 쓰는 DB임을 고려해 적용 시간을 정한다.

1. 같은 Supabase 프로젝트의 SQL Editor에서 SQL 전체를 검토한다.
2. 사전 조건이 달라졌다면 실행을 중단하고 다시 비교한다. 이미 일부 테이블을 만든 상태에 맞춰 임의로 문장을 지우고 실행하지 않는다.
3. 하나의 트랜잭션으로 구조 추가·권한 설정·검증·해당 5개 migration 이력 기록을 처리한다. 기존 고객·예약·직원 행은 변경하지 않는다. 테이블 잠금을 제시간에 얻지 못하거나 검증이 실패하면 커밋되지 않는다.
4. 적용 뒤 테이블 7개, 투어 컬럼 2개, schedule nullable, RLS·권한·기록 보존 트리거, 이력 5개를 다시 조회한다.
5. Railway에서 인증된 `/health/ready`와 관리자 웹의 재고·직원·예약 조회를 확인한다. `/health/live`는 프로세스 상태이고, 현재 `/health/ready`도 모든 기능의 스키마를 확인하지는 않는다. 예약 등록·취소 및 Beds24 연동 검증에는 별도 테스트 예약이 필요하다.

보완 후 성공 이력이 22개에서 27개로 늘어난 것을 확인했다. 나머지 이력상 미적용 15개와 기존 체크섬 불일치 2개는 그대로 남는다. 이들은 이미 만들어진 실제 구조, 데이터 이관 완료 여부, 원래 적용했던 SQL을 대조한 다음 별도 정리해야 한다. 존재 여부만 보고 일괄 성공 처리하지 않는다.

Prisma의 일반적인 수동 변경 이력 정리 방법은 `migrate resolve --applied`다. 이번 SQL은 확인된 누락분만 반영하고 그 5개의 성공 이력을 같은 트랜잭션에 기록하는 전용 보완안이다. 기존 성공 이력의 내용을 수정하는 작업은 포함하지 않는다. 참고: [Prisma hotfix 이력 정리](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/patching-and-hotfixing).

## 검증 범위와 상태

- 운영 DB: 두 차례 읽기 전용 메타데이터 조회 후 롤백. 변경 없음.
- 원본 5개 SQL: 로컬 PGlite에서 테이블·RLS·컬럼·트리거 생성 및 기존 예시 투어 행 보존 확인.
- 관련 기존 테스트: 재고 DB 1개, 명령·예약 24개 통과.
- 통합 보완 SQL: 격리된 인메모리 PGlite에서 10개 시나리오 모두 통과. 전체 적용, 재실행 거부, 기존 테이블·함수·컬럼·NULL 허용 상태·미완료/완료 이력·선행 테이블 누락에 대한 거부, DDL 이후 권한 검증 실패 시 전체 롤백을 확인했다.
- 새 테이블 RLS 7개·트리거 2개·이력 5개 확인. Supabase와 같은 기본 권한을 재현한 환경에서 `anon`·`authenticated`와 테이블 7개의 14개 조합에 대해 권한 차단을 확인했고 `service_role` 권한은 유지됐다. 기존 예시 투어 행과 과거 체크섬 불일치 이력도 보존됐다.
- 검증한 SQL SHA-256: `366186171a7bdbc87eeb27739deb75946ebc3c68934ccefb3c9afc79dbb9d602`. 검증 결과는 `tmp/guest-stay-qa/backend-repair-validation-20261005.json`에 있다.
- 운영 SQL은 사용자가 직접 실행했다고 보고했으며, 이후 별도 읽기 전용 연결에서 반영된 구조·이력을 확인했다. 에이전트는 운영 DB를 변경하지 않았다. 적용 후 점검은 `tmp/guest-stay-qa/backend-db-readiness-20261005-after.json`에 저장했다.
- 실제 DB에서 대상 테이블 7개 RLS 활성화와 클라이언트 역할 권한 14개 조합 차단, 기록 보존 트리거 2개 활성화를 확인했다. 소스와 대조한 누락 테이블·컬럼은 0개다. 기기 pairing_hash의 NULL 허용 차이와 이전 이력 차이는 남아 있다.
- 사용자 지정 도메인은 초기 조회에서 이름 해석 실패가 있었지만, 적용 후 다시 외부 조회하여 `https://api.voidanchae.com/health/live`의 HTTP 200과 `{"status":"ok"}`를 확인했다. 인증된 `/health/ready`, Railway 실제 DB 역할, 로그인부터 업무 화면까지의 동작은 별도 확인이 필요하다.

로컬 점검 근거: `tmp/guest-stay-qa/backend-db-readiness-20261005.json`. 이 파일과 조회 스크립트는 Git 제외 디렉터리에 있으며 비밀번호·토큰·고객 데이터는 포함하지 않는다.
