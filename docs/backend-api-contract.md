# 공통 백엔드 API 계약 초안

작성일: 2026-10-05 · 상태: 목표 계약, 초기 조회·관리 API 구현

구현 진행: 초기 조회·사업자 설정 endpoint가 로컬 실행 가능한 API에 추가됐다. [현재 구현 범위](backend-implementation.md)와 `packages/contracts/backend-routes.ts`가 실제 제공 경로의 기준이다. 아래 세션·worker·업무 변경 예시 전체가 구현됐다는 의미는 아니다.

[백엔드 설계](backend-architecture.md)를 구현할 때 웹·직원 앱·패드가 사용할 계약이다. 아래 새 경로·필드·상태는 제안이며 기존 API 응답을 바꿨다는 의미가 아니다. 첫 구현에서는 bootstrap·오늘·캘린더 조회를 우선하고 쓰기는 기능별로 이전한다.

## 1. 주소와 인증 경계

| 주소 | 대상 / 인증 |
| --- | --- |
| `/api/app/v1/*` | 직원 웹·Android. 사용자 인증 + 최신 사업자·숙소·기능 권한 |
| `/api/guest/v1/*` | 투숙객. 예약 접근권한·게스트 세션 |
| `/api/device/v1/*` | 페어링된 객실 패드. 기기·숙소·명령 범위 |
| 기존 `/api/v1/*` | 외부 파트너의 API 키 계약 유지 |
| 기존 `/api/*` | Next 호환 handler. 이전된 기능만 새 API에 연결 |
| 내부 작업 | 원칙적으로 HTTP 호출 대신 공통 업무 모듈 실행. 운영용 제어 endpoint가 필요하면 직원·게스트와 별도 서비스 인증 |

API 도메인은 배포 업체 선정 후 정한다. 웹은 동일 출처의 Next 호환 경로/BFF를 이용하며, Android는 HTTPS 공통 API에 직접 연결한다. 기존 공개 예약·결제 webhook·초대장·고정 QR URL은 유지하고 내부 처리 위치만 바꾼다. 경로 변경으로 이미 보낸 링크를 무효화하지 않는다.

컨트롤러에 필요한 capability와 자원 범위를 명시한다. 기존 `operational-access.ts`의 URL 이름 기반 추론을 새 경로에 자동 적용했다고 가정하지 않는다. 권한 없는 신규 경로를 기본 허용하지 않는다.

## 2. 공통 자료형

- 업무 날짜는 숙소 현지 날짜 `YYYY-MM-DD`이며 현재 한국 숙소는 `Asia/Seoul`을 사용한다. 생성·수정·로그 시각은 UTC ISO 8601로 전달한다.
- 투숙 기간은 `[checkIn, checkOut)`로 정의한다. 체크아웃일의 청소·퇴실 표시는 숙박 바와 별개다.
- 기존 문자열 ID를 보존한다. 정수 금액은 `amountMinor`와 `currency`를 함께 제공한다.
- 성공은 `{ data, meta }`, 실패는 `{ error, meta }`로 정의한다. `meta.requestId`는 로그를 찾는 ID이며 자격증명으로 사용하지 않는다.
- 오류 응답에 스택·DB 연결 정보·원본 토큰·고객 메시지 본문을 넣지 않는다. 개인 데이터 응답의 초기 캐시 정책은 `private, no-store`다.
- 직원 인증 후의 성공·권한 오류에는 `X-Access-Revision` 헤더로 현재 scope revision을 제공한다. 값이 바뀌면 앱은 권한 캐시를 폐기하고 bootstrap을 다시 읽는다. 401은 캐시를 닫고 인증부터 복구하며, 헤더는 인가를 대신하지 않는다. CORS 직접 호출에서는 이 헤더를 명시적으로 노출한다.
- OpenAPI에서 필수/선택/nullable, enum, 최대 수량·길이와 오류를 명시하고 실제 controller와 계약 시험에서 일치시킨다. [NestJS OpenAPI 공식 문서](https://docs.nestjs.com/openapi/introduction)

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "다른 담당자가 변경했습니다. 최신 내용을 확인해 주세요.",
    "retryable": false,
    "details": { "currentVersion": 8 }
  },
  "meta": { "requestId": "request_example" }
}
```

| HTTP | 의미 / 클라이언트 처리 |
| --- | --- |
| 400 / 422 | 입력·조회 범위 오류. 사용자가 내용을 수정 |
| 401 | 인증 만료·폐기. refresh 시도 또는 다시 로그인 |
| 403 | 기능·역할 거절. 자동 재시도 금지 |
| 404 | 현재 접근 범위에 없는 대상. 타 사업자 자원의 존재를 노출하지 않음 |
| 409 | 버전 충돌, 키의 다른 내용 재사용, 업무 상태 충돌. 최신 상태 확인 |
| 429 | 요청 제한. `Retry-After` 이후 허용된 방식으로 재시도 |
| 503 | 일시 불가·필수 schema 미적용. 저장 성공으로 표시하지 않음 |

HTTP 성공과 외부 작업 완료를 구분한다. 202는 접수됨이며 예약 확정·메시지 발송 완료가 아니다. 기존 `migrationRequired` 등의 의미는 adapter에서 유지한다.

## 3. 로그인과 초기 화면

새 세션 계약은 `POST /auth/login`, `POST /auth/refresh`, `DELETE /auth/session`을 직원 API 하위에 둔다. 사용자 이름·사업자를 앱이 임의 지정하지 않고 기존 계정에서 해석한다. 반복 로그인 제한과 오류 문구는 계정 존재 여부를 불필요하게 노출하지 않게 한다.

로그인 성공을 캘린더·문의함 조회 성공에 종속시키지 않는다. 메시지 권한이 없는 직원도 로그인한 후 허용된 메뉴를 사용할 수 있어야 한다.

`GET /api/app/v1/bootstrap` 제안:

```json
{
  "data": {
    "user": { "id": "user_example", "name": "예시 직원", "role": "manager" },
    "organization": { "id": "org_example", "name": "예시 사업자" },
    "capabilities": ["operations.calendar.read", "inventory.record"],
    "properties": [
      {
        "id": "property_example",
        "name": "예시 숙소",
        "capabilities": ["operations.calendar.read", "inventory.record"]
      }
    ],
    "propertiesPage": { "hasMore": false, "nextCursor": null },
    "scopeVersion": "opaque_scope_revision",
    "timezone": "Asia/Seoul"
  },
  "meta": { "requestId": "request_example", "generatedAt": "2026-10-05T00:00:00Z" }
}
```

capability 이름은 계약의 예시이며 기존 메뉴 키와 명시적으로 매핑한다. `scopeVersion`은 계정·사업자·숙소 기능/배정 상태를 반영하는 revision으로 설계하며 기존 DB의 단일 컬럼을 가리키지 않는다. 서버는 매 요청 최신 권한을 확인한다. Bootstrap 값을 요청 헤더로 돌려받았다는 이유로 신뢰하지 않는다.

슈퍼매니저의 `organization`은 null일 수 있고, 사업자 선택 목록은 별도 페이지 조회로 제공한다. Bootstrap은 허용된 전체 숙소를 무한히 싣지 않도록 초기 목록을 제한하고 `propertiesPage`로 추가 조회를 안내한다. 위 예시는 작은 사업자의 응답이다. 캐시된 목록과 선택 중인 숙소는 권한 변경 시 다시 평가한다.

기존 모바일 프록시는 활성 admin/manager만 허용하고 로그인 시 캘린더·문의 조회를 함께 수행한다. 현재 super_admin/cleaner 및 기능 제한 계정과 맞지 않는 부분이므로 새 bootstrap으로 대체할 대상이다. Android 첫 출시에서 지원할 화면 범위는 별도 확정하되 서버의 역할 규칙을 둘로 만들지 않는다.

## 4. 첫 조회 API

| 새 직원 API 하위 경로 | 내용 | 기존 구현 대응 |
| --- | --- | --- |
| `GET /operations/today?date=2026-10-05` | 권한 내 당일 입퇴실·청소 기본판 | `/api/ops/today?view=board` |
| `GET /calendar?month=2026-10&propertyId=...` | 표시 구간의 예약 바·청소 배정 | `/api/admin/calendar` |
| `GET /cleaner/calendar?month=2026-10&propertyId=...` | 청소 업무에 필요한 일정·배정 요약 | `/api/events`의 청소 권한 예외 및 기존 청소 조회 |
| `GET /properties?cursor=...&limit=50` | 숙소 요약, 권한과 상태 반영 | `/api/properties` |
| `GET /staff?organizationId=...&cursor=...&limit=50` | 사업자별 직원 | `/api/staff` |
| `GET /properties/{id}/assignees` | 해당 숙소의 배정 가능한 인원 | `lib/staff-directory.ts` |
| `GET /operations/today/attention?date=...` | 권한 내 문의·확인 필요 사항 | 기존 부가 조회를 조사하여 연결 |

일반 목록은 기본 50·최대 100건을 초기안으로 하고 안정적인 `(sortKey, id)` 순서의 불투명 cursor를 사용한다. Cursor는 사용자 범위·필터에 묶으며 만료/범위 변경 시 처음부터 조회하게 한다. 화면 표시를 위해 전체 건수 쿼리를 매번 강제하지 않는다.

`operations.calendar.read`는 기존 예약 관리 권한에, `cleaning.schedule.read`는 청소 일정 권한에 대응한다. 청소 projection은 필요한 입퇴실 날짜·청소 대상과 배정을 제공하고 예약자 연락처·전체 메시지·결제 정보를 제외한다. 청소 권한만 있는 계정이 관리자 예약 상세에 접근하지 못하는 fixture를 필수로 둔다.

### 캘린더와 오늘의 범위

캘린더는 서버가 기존 `calendarGridRange` 규칙으로 구간을 계산해 `rangeFrom`, `rangeTo`를 반환한다. 월 그리드의 앞뒤 날짜가 포함된다. 원본 체크인/체크아웃을 변경하지 않고 클라이언트가 표시 구간에 맞춰 바를 그린다.

```json
{
  "data": {
    "rangeFrom": "2026-09-27",
    "rangeTo": "2026-11-01",
    "coveredPropertyIds": ["property_example"],
    "linkedCheckoutCleaningsIncluded": true,
    "snapshotAt": "2026-10-05T00:00:00Z",
    "stays": [
      {
        "id": "stay_example",
        "sourceType": "event",
        "sourceId": "event_example",
        "propertyId": "property_example",
        "checkIn": "2026-09-30",
        "checkOut": "2026-10-02",
        "label": "예시 예약",
        "status": "confirmed",
        "cleaningId": "cleaning_example"
      }
    ],
    "cleanings": [
      {
        "id": "cleaning_example",
        "propertyId": "property_example",
        "date": "2026-10-02",
        "assignee": { "id": "user_example", "name": "예시 담당자" },
        "status": "pending"
      }
    ],
    "complete": true
  },
  "meta": { "requestId": "request_example", "generatedAt": "2026-10-05T00:00:00Z" }
}
```

한 달/표시 숙소 묶음에 대해 필요한 예약·청소를 완전히 반환한다. 한 요청의 초기 상한은 서버가 계산한 월 표시 구간·20숙소, 반환 예약·청소 합계 5,000건을 제안하며 실제 fixture로 조정한다. 현재 `calendarGridRange`는 일~토 월간 그리드와 월~일 모바일 주간을 함께 포함하므로 최대 43일이 될 수 있다. 42일로 임의 제한하지 않는다. 예시 2026년 10월은 9월 27일~11월 1일이다. 지점/건수 초과 시 `RANGE_TOO_LARGE`를 반환하고 화면이 숙소 묶음을 나누어 조회한다. 한 숙소 자체가 건수 상한을 넘으면 기간별 분할 조회 계약을 적용하거나 제한을 조정하며 완전성이 확인될 때까지 조회 실패를 표시한다. 일부만 내려주고 ‘미배정’으로 표시하는 동작은 허용하지 않는다.

조회 조건은 투숙 overlap과 체크아웃 경계 표시를 각각 처리한다. 9월 화면에서 보이는 예약의 체크아웃이 표시 범위 밖이어도 관련 청소를 가져온다. 같은 예약이 `Booking`과 `Event`에 모두 있는 경우 원본 ID/외부 참조로 합치는 현재 규칙을 조사·고정하며 제목이 같다는 이유로 합치지 않는다. 두 개 이상 청소가 일치하면 임의 첫 행을 붙이지 않고 확인 필요 상태를 제공한다.

예약과 청소는 짧은 repeatable-read 트랜잭션 등 **하나의 일관된 읽기 snapshot**으로 조합한다. `complete`는 `coveredPropertyIds`·표시 날짜·연계 체크아웃 청소 범위에 대한 완료 의미다. `snapshotAt`은 읽기 단위의 시각이며 변경 cursor가 아니다. 서로 다른 달·숙소 묶음의 응답은 동일 snapshot이라고 주장하지 않는다.

청소 version 도입 전 조회 단계에서는 화면 요청 순서와 무효화로 오래된 응답이 현재 화면을 덮지 못하게 한다. version 도입 후에는 `Cleaning.id/version` 비교도 적용한다. 담당자 목록은 별도 조회하되 현재 배정자 요약은 청소 응답에 포함하여 목록 미조회가 미배정으로 보이지 않게 한다. 기존 handler의 `cleaners`, `supplyTodos`와 민감 상세 필드는 [설계서의 compatibility adapter 방침](backend-architecture.md#9-성능과-운영)에 따라 제공한다. 부가 정보 준비 전에는 empty 값으로 확정하지 않는다.

오늘 API의 `date`는 한 날짜만 받는다. 권한상 접근 가능한 숙소를 서버에서 제한한다. 기본 응답에서 문의 원문·카메라 사진·전체 고객 이력을 제외하고 기존 board에 필요한 내용만 제공한다. 서로 다른 역할의 오늘 화면은 같은 업무 서비스에서 별도 projection으로 만든다.

## 5. 변경 명령과 재시도

새 쓰기 계약의 예시다. 기존 모델에 version이 없는 청소 등은 해당 이전 단계의 schema/호환 작업을 먼저 진행한다.

```http
POST /api/app/v1/cleanings/cleaning_example/reassign
Authorization: Bearer <access-token>
Idempotency-Key: <client-generated-uuid>
Content-Type: application/json

{
  "assigneeId": "user_example",
  "expectedVersion": 7
}
```

키의 범위는 `(actorId, canonicalOperation, key)`로 고정한다. API 주소 변경이나 숙소의 사업자 이동으로 키의 정체성이 바뀌지 않게 한다. 요청 hash에는 대상 ID·버전·의미 있는 입력 본문을 포함하며, 접수 당시 사업자는 명령 metadata에 고정하고 재조회한 새 소속으로 hash를 다시 만들지 않는다. 서로 다른 기기에서도 같은 명령을 참조하도록 기기별 키 공간을 추가하지 않는다. 현재 계정·대상 권한을 확인한 뒤 기존 명령을 찾으며, 과거 결과의 열람 권한도 별도로 확인한다. 권한이 회수됐다고 기존 키를 새 명령으로 재사용하지 않는다.

처리 순서는 다음과 같다.

1. 입력과 최신 권한을 검증하고 신뢰할 수 있는 대상 숙소·사업자를 해석한다.
2. 동일 키의 기존 명령을 확인한다. 내용이 다르면 `IDEMPOTENCY_KEY_REUSED` 409, 완료면 현재 권한으로 허용된 원 결과를 반환한다. 이전 성공을 조회할 때는 오래된 expectedVersion 때문에 새 충돌로 바꾸지 않는다.
3. 신규 명령이면 unique 제약으로 중복 접수를 막는다. DB 내부 작업은 현재 소속·권한 버전을 다시 확인하고 대상 행의 버전 조건, 업무 변경, 감사 기록, outbox, 명령 성공 결과를 같은 트랜잭션에 저장한다. 소속 변경과의 경합을 막는 잠금/버전 규칙도 명시한다.
4. 외부 작업이면 실행 의도와 명령을 먼저 저장하고 202를 반환한다. worker는 사용자 명령의 계정·사업자·숙소·기능 권한을 실행 직전 다시 확인한다. 아직 외부 호출하지 않은 명령은 권한 회수 시 거절 상태로 남긴다. 이미 외부 호출한 명령은 복구 권한으로 결과 확인을 끝낸다. 정기 동기화는 별도 시스템 주체를 사용하며 모든 실행은 lease·기존 외부 결과를 확인한다.
5. 명령 상태는 `GET /commands/{id}`로 조회한다. 새 요청 키로 같은 작업을 자동 재생성하지 않는다.

```json
{
  "data": {
    "commandId": "command_example",
    "status": "accepted",
    "statusUrl": "/api/app/v1/commands/command_example"
  },
  "meta": { "requestId": "request_example" }
}
```

| 명령 상태 | UI 의미 / 서버 처리 |
| --- | --- |
| accepted / running | 접수·처리 중. 같은 명령 상태를 조회 |
| succeeded | 정의된 작업 성공 확인. 메시지라면 provider 접수와 실제 전달을 추가 구분 |
| failed | 실패가 확인됨. 재시도 가능 여부와 재접수 조건을 명시 |
| reconciliation_required | 외부 결과 불명. 자동 재전송 대신 재조회·운영자 확인 |

`unknown` 등 기존 상태는 위 표의 의미로 매핑하고 원 기록을 유지한다. 재시도 가능한 실패도 기존 명령의 재실행 요청으로 처리하며 단순 중복 POST는 임의 재실행하지 않는다. 명령 hash/ID 보존 기간은 최대 오프라인 재전송 기간보다 길게 잡는다. 지연된 오래된 명령을 보존 기간 이후 신규 작업으로 실행하지 않도록 명령 유효 기간과 정리 후 거절 규칙을 함께 확정한다.

버전 충돌 시 클라이언트가 최신 버전만 끼워 넣어 자동 재전송하지 않는다. 사용자가 최신 배정·실사·설정을 보고 다시 결정하도록 한다. 청소 재배정 이벤트에는 변경 전후 담당자 ID와 작업 버전을 고정해 이후 수정이 취소 안내 대상을 바꾸지 않게 한다.

## 6. 이벤트와 권한 변경

업무 이벤트에는 `eventId`, `schemaVersion`, `type`, `organizationId`, `propertyId`, `aggregateId`, `aggregateVersion`, `occurredAt`, `actor`, 최소 payload를 포함한다. 예시는 `cleaning.assignment.changed`, `inventory.count.recorded`, `reservation.synced`, `inquiry.review.required`, `access.changed`다. 이 이름들은 신규 계약이며 현재 발생 중이라고 표시하지 않는다.

Outbox 발행의 중복과 순서 역전을 예상한다. consumer는 이벤트 ID를 중복 처리하지 않고 업무 버전·현재 상태를 확인한다. 오래된 배정 알림은 상황에 맞게 보류/대체하며, 취소 안내의 대상과 관련 버전 이력은 남긴다. 공급자 응답이 불명인 발송은 lease 만료만으로 재발송하지 않는다.

권한이 바뀌면 서버 요청부터 즉시 최신 범위를 적용한다. 앱은 다음 성공 응답/권한 오류의 `X-Access-Revision` 변경으로 목록과 캐시를 갱신한다. 이미 offline인 기기의 자료를 원격으로 즉시 삭제했다고 보장하지 않는다. 민감 자료의 저장 범위·로컬 만료 시간을 제한한다.

실시간 알림은 변경을 알아차리는 신호이며 데이터 원본이 아니다. 최초 버전은 알림 수신/앱 재개 후 범위 조회로 최신 상태를 얻는다. 향후 변경 cursor를 추가할 때는 삭제 tombstone, 권한 회수, cursor 만료·전체 재조회, 트랜잭션 commit 순서로 누락되지 않는 계약을 별도로 정의한다. 단순 `updatedAt > 마지막시간`만으로 완전한 동기화를 보장하지 않는다.

## 7. 계약과 호환성 검증

| 검증 | 필수 사례 |
| --- | --- |
| 역할 | super_admin/admin/manager/cleaner, 미소속, 비활성, 메뉴 null/[], 사업자 기능 OFF |
| 자원 범위 | 다른 사업자의 목록·상세·파일·명령·로그 차단, 이동 후 이전 권한 회수, 과거 정산 귀속 |
| 날짜 | 9월/10월 경계 예약과 10월 2일 청소 동일, 월 밖 체크아웃, 장기 투숙, 체크아웃 당일 |
| 재시도 | 동일 키 같은 내용, 같은 키 다른 내용, 동시 같은 키, 응답 유실 후 조회, 사업자 이동 후 같은 키, 프로세스 종료 후 복구 |
| 외부 처리 | 성공 후 연결 끊김, 429, 확정 실패, webhook 중복·역순, 알림 결과 불명 |
| 앱 | 로그인 성공과 기능 조회 분리, 토큰 회전·회수, 계정 전환, 초안과 제출본 분리, 사진 미업로드 |
| 이전 | 새/기존 handler의 범위·업무 의미 동일, scheduler 단일 소유, rollback 중 중복 외부 작업 없음 |

읽기 비교는 고정 fixture 또는 동일 DB snapshot으로 수행한다. 변하는 운영 DB를 순서대로 두 번 읽은 차이를 코드 오류로 단정하지 않는다. 쓰기 비교는 모의 외부 provider와 격리 DB에서만 수행하며 실제 예약·메시지를 두 번 실행하지 않는다.

OpenAPI는 CI에서 생성·diff를 확인하고, 앱이 사용 중인 v1의 필드 제거·타입 변경을 막는다. 필드 추가는 클라이언트의 미지 필드 허용과 enum fallback을 검증한 뒤 진행한다. 실제 지원 중인 앱 버전을 확인하고 호환 종료 일정을 정한 후 v1 제거를 검토한다.
