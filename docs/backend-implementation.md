# 공통 백엔드 구현과 실행

2026-10-05. 독립 NestJS API와 사업자 관리 공통 서비스를 구현했다. 운영 배포 또는 운영 DB 반영 보고서는 아니다.

## 구현 범위

| 영역 | 현재 제공 |
| --- | --- |
| 실행 | `services/api` 독립 프로세스, 상태 확인, 종료 처리, 서버 설정 검증, Next 런타임 의존 없는 번들 |
| 인증 | 기존 직원 `va_session` 서명·만료 확인, 현재 계정 상태·역할·사업자·배정·기능 재조회 |
| 조회 | bootstrap, 숙소·직원 페이지 조회, 오늘 입퇴실·청소, 관리자·청소 캘린더 |
| 사업자 관리 | 사업자 생성·소속 이동·옵션 변경, 관리자 초대 링크 발급 |
| 사용자 권한 | 사업자 범위의 역할·메뉴·지점 배정 변경, 슈퍼매니저와 사업자 관리자 분리 |
| 지점 추가 | 사업자 요청, 슈퍼매니저 승인·반려 |
| 활동 기록 | 변경과 같은 트랜잭션에 감사 기록 저장, 사업자별 조회 |
| 중복 요청 | 동일 키·동일 내용 재조회, 다른 내용 거절, 결과 암호화, 동시 수정·감사 실패 롤백 |
| 웹 연결 | 기존 설정 화면의 요청을 환경 설정으로 독립 API에 위임, 신규 `/api/app/v1/*` 경로 |

API의 실제 경로는 `packages/contracts/backend-routes.ts`, 변경 입력은 `packages/contracts/operations.ts`가 원본이다. 서버의 `/openapi.json`은 서버 연결 키를 확인한 후 경로와 요청 스키마를 제공한다. 응답은 현재 공통 envelope와 TypeScript 반환 타입으로 정의돼 있으며, 전체 세부 응답 모델의 OpenAPI 클라이언트 생성은 후속 작업이다.

## 실행

Node.js 22.12 이상 또는 지원되는 최신 LTS를 사용한다. 현재 로컬 검증은 Node.js 24에서 진행했다.

```sh
npm ci
npx prisma generate
npm run backend:typecheck
npm run backend:build
npm run backend:start
```

`backend:start`는 `.env`, `.env.local` 순서로 읽는다. 환경 파일과 비밀값은 커밋하지 않는다. `.env.example`의 설정 이름을 참고한다.

| 설정 | 의미 |
| --- | --- |
| `JWT_SECRET` | 기존 직원 웹 세션과 같은 검증 키 |
| `BACKEND_BRIDGE_SECRET` | Next 서버와 API 사이의 별도 연결 키. 32자 이상, 브라우저·앱에 전달 금지 |
| `BACKEND_COMMAND_SECRET` | 저장된 변경 결과·서비스 계정 암호화 키. 32자 이상. DB에 저장된 Beds24 계정을 사용하는 기존 Next 예약 서버에도 API와 동일한 키 설정 |
| `BACKEND_WEB_ORIGIN` | 관리자 웹의 정확한 출처. 예: 로컬 `http://localhost:3117`, 운영 `https://voidanchae.com` |
| `BACKEND_API_URL` | Next 서버가 호출할 독립 API 주소. 로컬 HTTP는 loopback만 허용, 외부 주소는 HTTPS |
| `BACKEND_HOST` / `BACKEND_PORT` | 기본 `127.0.0.1:4100`. 컨테이너 접근이 필요하면 허용된 네트워크에 맞춰 host 설정 |
| `DATABASE_URL` 또는 `DB_HOST/DB_USER/DB_PASSWORD` | 명시적으로 지정한 같은 PostgreSQL 데이터베이스. 샘플 운영 주소로 자동 연결하지 않음 |
| `BACKEND_DB_POOL_SIZE` | 프로세스당 연결 수. 기본 3, 기존 Next와 합산해 DB 한도 안에서 설정 |
| `BACKEND_DB_SSL` | 필요 시 `require`. 운영은 인증서 검증 TLS를 사용하고 URL의 약한 SSL 옵션을 거절 |
| `BACKEND_MANAGEMENT_ENABLED` | Next 측 기존 설정 화면 위임 여부. 기본 `false` |

운영 데이터베이스 URL의 SSL query 옵션을 사용한다면 `sslmode=verify-full`을 지정한다. 공급자 인증서와 연결 정책에 맞춰 staging에서 먼저 확인한다.

암호화 키를 임의로 교체하면 과거 요청 결과를 재조회할 수 없다. 기존 키를 안전하게 보관하고, 키 버전과 재암호화 절차를 마련한 뒤 교체한다. 성공한 명령 기록을 삭제해 동일 키가 새 요청으로 실행되도록 만들지 않는다.

### 기존 예약 서버와 DB 서비스 계정 (2026-10-28)

새 관리자에서 등록한 서비스 계정은 `rate_connection_credentials`에 암호화되어 저장되고 상태는 `setup`이다. 기존 예약 서버는 `setup`과 `ready`를 허용하되, 저장된 인증의 사업자·계정·버전과 실제 예약에 사용하는 `BEDS24_REFRESH_TOKEN` 일치를 검증한다. `paused` 계정은 계속 차단한다. DB 저장 계정은 환경변수의 과거 인증값으로 우회하지 않는다.

배포 시 기존 예약을 처리하는 Netlify/Next 서버에 API의 **현재** `BACKEND_COMMAND_SECRET`을 동일하게 설정한다. 새 키를 만들거나 기존 API 키를 바꾸지 않는다. 브라우저 공개 환경변수로 지정하지 않는다. 기존 요금 서비스 계정 migration이 적용된 환경에는 이번 수정용 DB 쿼리가 필요 없다.

`rate_connection_mismatch`의 `reason`은 다음 문제를 구분한다. 원문 토큰·암호문은 오류 응답에 포함하지 않는다.

- `credential_key_missing`: 예약 서버의 암호화 키가 없거나 32바이트 미만이다.
- `stored_credential_unreadable`: 서버 키 또는 저장된 인증의 사업자·계정·버전이 맞지 않거나 암호문이 손상되었다.
- `stored_credential_missing` / `credential_generation_mismatch`: 저장된 인증이 없거나 버전이 다르다.
- `reservation_account_mismatch`: 저장한 Beds24 토큰과 기존 예약 서버의 토큰이 다르다. 문자열이 다르면 같은 계정이라고 추정하지 않는다.
- `connection_inactive`: 연결이 사용 중지되어 있다.
- `environment_credential_missing`: 과거 환경변수 방식 계정의 인증 설정이 없거나 버전이 다르다.

재시도 전에 해당 설정을 확인한다. 성공 여부가 불확실한 예약의 처리 키·판매 제한을 삭제하거나 연결 상태를 강제로 `ready`로 변경하지 않는다. 이번 검증은 로컬 테스트이며 실제 게스트 예약을 만들지 않았다.

## DB 업데이트와 연결 순서

1. 별도 검증 DB에 기존 migration과 `20261005010000_backend_commands`, `20261005150000_reservation_workflows`를 적용한다. 프로젝트의 기존 migration 이력이 먼저 일치해야 한다. 전체 미적용 migration을 먼저 검토하고, 운영에서 일괄 실행부터 하지 않는다.
2. 실행 역할이 사업자·사용자·숙소·감사·명령 테이블을 서버에서만 읽고 쓸 수 있는지 확인한다. 새 명령 테이블은 RLS를 켜고 브라우저 역할 접근을 차단한다. 별도 서버 DB 역할을 쓰면 그 역할의 권한 정책을 운영 환경에 맞게 부여한다.
3. API를 실행하고 공개 `/health/live`, 서버 키가 필요한 `/health/ready`를 확인한다. 준비 상태는 사용자·사업자·명령 테이블을 확인하며 Beds24를 호출하지 않는다.
4. Next에 연결 주소·키·웹 출처를 설정하고 `/api/app/v1/bootstrap` 및 역할별 조회를 확인한다. 새 경로도 기존 로그인 쿠키가 필요하다.
5. 백업과 staging 검증 후 운영 DB migration을 적용하고 API를 배포한다. 그다음 Next의 `BACKEND_MANAGEMENT_ENABLED=true`로 설정 화면 요청을 전환한다.

기존 migration 이력이 확인된 환경의 실행 명령은 다음과 같다. 이 작업에서는 운영 환경에 실행하지 않았다.

```sh
npx prisma migrate status
npx prisma migrate deploy
```

전환되는 기존 웹 경로는 `/api/admin/organizations`, `/api/admin/operations-settings`, `/api/admin/user-access`, `/api/admin/property-requests`, `/api/admin/activity`와 해당 하위 경로다. GET/POST/PUT/PATCH 중 원래 지원하는 동작만 위임한다. 초대 링크 발급은 발송 완료를 의미하지 않는다.

연결 실패 시 같은 요청을 기존 Next 쓰기로 재실행하지 않는다. 결과가 불명확한 명령은 원래 `Idempotency-Key`로 다시 확인한다. 설정 화면은 요청 내용의 해시와 키만 탭의 sessionStorage에 보관해 같은 내용 재시도와 새로고침을 지원한다. 브라우저 저장이 차단되면 현재 페이지 메모리 내에서만 유지되며, 탭 종료·저장소 삭제 후에는 활동 기록 확인이 필요하다.

롤백은 전환 플래그를 끄되 **응답을 받지 못한 변경 요청부터 활동 기록과 기존 명령 결과로 확인**한 뒤 한다. 미확인 요청을 구형 쓰기로 다시 보내지 않는다. 새 테이블과 키는 보존한다.

## 조회와 권한 기준

- 목록 기본 50·최대 100건. 커서는 계정 권한 범위와 연결하며 만료·범위 변경 시 처음부터 조회한다.
- 오늘·달력은 최대 20숙소, 예약·청소 합계 상한 5,000건. 초과 시 잘린 결과 대신 범위를 줄이도록 오류를 반환한다.
- 월간 그리드의 앞뒤 날짜와 보이는 예약의 월 밖 체크아웃 청소를 함께 읽는다. 같은 읽기 트랜잭션 안에서 예약과 청소를 조합한다.
- 청소 조회에는 예약자 이름·연락처·결제 정보를 노출하지 않는다. 배정자 요약은 청소 응답 자체에 포함한다.
- 권한 revision은 캐시 갱신 신호다. 요청마다 최신 권한을 확인하고 변경 명령은 트랜잭션 안에서 다시 확인한다.
- 변경 명령은 상태·버전 검증, 업무 변경, 감사 기록, 암호화된 결과를 같은 트랜잭션에 저장한다. 외부 메시지 전송을 이 트랜잭션에 추가하지 않는다.

## 아직 전환하지 않은 부분

- 기존 오늘·캘린더 웹 응답에는 메시지·퇴실 신호·카메라·추가 담당자 정보가 더 있다. 새 오늘 응답은 미조회 항목을 `deferredSections`로 명시하며 기존 화면을 부분 데이터로 덮지 않는다.
- 직원 등록·정보 수정·로그인 설정·초대 발급·일정 링크·퇴사/복원은 독립 API로 구현했다. 일반 초대 수락과 기존 직원 병합은 기존 경로를 유지한다.
- Android 직접 로그인·refresh token 회전, 패드·게스트 인증 이전, worker·스케줄러·외부 메시지 발송·결제 이전은 후속 단계다. 서버 연결 키를 앱에 넣어 우회하지 않는다.
- 운영 속도 개선 수치는 아직 측정하지 않았다. 독립 실행만으로 오늘·달력의 실제 응답 시간이 빨라졌다고 판단하지 않는다.

## 검증

```sh
npm run backend:test
npm test
npm run backend:typecheck
npx tsc --noEmit --incremental false
npm run backend:build
```

새 테스트는 격리된 PGlite와 HTTP fixture를 사용한다. 실제 예약·문자·Beds24 발송 또는 운영 DB 변경 없이 역할·사업자 격리, 월 경계, 입력 한도, 중복 요청, 암호화, 롤백과 웹 연결을 확인한다.

이번 검증 결과: 전체 회귀 테스트 725개와 추가 연결 설정 테스트 3개 통과. 전체 TypeScript 검사, 변경된 백엔드의 ESLint, 독립 API 빌드와 별도 출력 폴더의 Next 웹 빌드가 통과했다. 독립 실행 파일에서 `/health/live` 200, 미인증 조회 401, 의도적으로 연결할 수 없는 테스트 DB에 대한 `/health/ready` 503을 확인했다. 이는 실제 운영 DB 연결·처리 속도·배포를 검증했다는 뜻이 아니다.

## 2026-10-05 우선 업무 기능 확장

`services/api/workflows.ts`가 예약 상세·메모·초대 링크·가용 조회·등록·취소·처리 결과 확인, 재고 기록, 세탁 출고/입고/정정, 텍스트 비품 요청/처리, 월 청소 정산/CSV, 직원 관리, 고객 명부/사업자별 메모/연결 검토, 종로 행사/사진 업로드를 연결한다. 계약은 `packages/contracts/reservations.ts`, `field-operations.ts`, `people-events.ts`를 포함한다. 별도 프론트는 `C:\voidproject\hosting-manager-web`이다.

모든 쓰기는 최신 사업자·숙소·역할·기능 범위를 재검사한다. 같은 요청 결과 재조회 전에도 대상 권한을 확인한다. 일반 변경은 업무/감사/암호화 결과를 한 트랜잭션에 저장한다. Beds24 예약 명령은 별도 영속 기록을 먼저 저장하고 외부 확인 후 확정하며, 결과 불명확 시 POST를 반복하지 않는다. 자세한 조건은 `packages/domain/reservations/README.md`에 있다.

행사 이미지 경로에만 3MiB 전송 한도를 허용하고 실제 파일은 2MiB 이하 JPEG/PNG/WebP인지 디코딩해 확인한다. `sharp`는 실행 의존성이며 사진은 메타데이터 제거 후 WebP로 변환한다. 기존 저장소 설정을 사용한다. 실제 스토리지 업로드는 이번 검증에서 하지 않았다.

새 코드 기준 백엔드 테스트 129개(격리 PGlite/HTTP), 독립 API 타입 검사·번들 빌드가 통과했다. 기존 Next 전체 테스트 725개 결과는 위 초기 분리 단계 기록이며 이번 확장의 재실행 결과가 아니다.

현재 연결 DB의 읽기 전용 점검에서 `backend_commands`, `backend_reservation_commands`, `backend_reservation_annotations`, `backend_guest_notes`가 없는 것을 확인했다. 두 migration은 작성만 했으며 적용하지 않았다. `/health/ready`가 성공하고 staging에서 역할별 조회/저장 및 Beds24 테스트 숙소 검증이 끝나기 전에는 운영 쓰기 전환 완료로 간주하지 않는다. 기존 Next 라우트·Prisma 주 스키마와 운영 데이터는 이번 확장 작업에서 수정하지 않았다.
