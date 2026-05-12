# voidanchae × 스테이폴리오 — API 통합 협의안

작성일: 2026-05-12
작성: voidanchae (호스팅 매니저 팀)
회의 목적: 양사 시스템 간 예약·청소 데이터 동기화 방식 합의

---

## 1. 한 줄 요약

- **voidanchae** 는 자체 호스팅 매니저(Next.js + Beds24 미러 + 청소 관리)를 운영
- **스테이폴리오** 가 한옥 4개 지점의 예약·청소 일정을 동기화하길 희망
- 양방향 통합을 위해 voidanchae 측에서 **REST API (v1)** + **OpenAPI 스펙** 준비 완료
- 본 미팅 목표: 스코프·청소부 운영·일정 합의

---

## 2. 통합 범위

| 영역 | 흐름 | 결정 사항 |
|---|---|---|
| **예약** (Booking) | Stayfolio → Beds24 → voidanchae (sync) | voidanchae 가 read-only 노출. 별도 push 엔드포인트 불필요. |
| **청소** (Cleaning) | Stayfolio ↔ voidanchae 양방향 | 풀 CRUD. 양사 모두 source of truth 가능 — first-write-wins. |
| **가용성** (Availability) | voidanchae → Stayfolio (read) | 일자별 점유 여부 노출. 스테이폴리오 측 더블북 방지용. |
| **숙소 정보** (Property) | voidanchae → Stayfolio (read) | 양사 시스템 간 propertyId 매핑용. |

---

## 3. 데이터 흐름 (다이어그램)

### 3-1. 예약 push (스테이폴리오 → voidanchae)

```
스테이폴리오 (예약 발생)
    │
    │  기존 채널 (Beds24 통합)
    ▼
Beds24 (채널 매니저)
    │
    │  voidanchae 5분 sync
    ▼
voidanchae Event 테이블 (channelId='stayfolio')
    │
    │  GET /api/v1/bookings?source=stayfolio
    ▼
스테이폴리오 (확인 read)
```

**합의 포인트**: 별도 직접 push 통합은 안 함. Beds24 통합 그대로 활용.

### 3-2. 청소 push (스테이폴리오 → voidanchae)

```
스테이폴리오 운영팀 (청소 일정 생성)
    │
    │  POST /api/v1/cleanings
    │  body: { propertyId, date, externalId, ... }
    ▼
voidanchae Cleaning 테이블 (externalSource='stayfolio')
    │
    ├──→ 호스트 캘린더에 표시
    └──→ 청소 담당자 (내부 풀 사용 시) 에게 신청 알림
```

### 3-3. 청소 상태 동기화 (양방향)

```
voidanchae 호스트가 청소 완료 마킹              스테이폴리오에서 청소 일정 수정
    │                                              │
    │  Cleaning.status = 'done'                    │  PATCH /api/v1/cleanings/{id}
    │  completedAt = now()                         │
    ▼                                              ▼
   DB ─────────────────────  ←→  ──────────────────  DB
    │                                              │
    │  GET /api/v1/cleanings (스테이폴리오 polling) │
    ▼                                              │
스테이폴리오 read                                  완료
```

---

## 4. 인증 모델

- 헤더: `Authorization: Bearer vd_live_<API_KEY>`
- 키 발급: voidanchae 측 관리자가 [admin/api-clients](https://voidanchae.com/admin/api-clients) 페이지에서 발급, **평문은 발급 시 1회만 노출** (이후 해시만 보관)
- 스코프 (스테이폴리오 권장): `properties:read`, `bookings:read`, `cleanings:read`, `cleanings:write`
- 지점 제한 옵션: 키별로 특정 지점에만 접근 제한 가능 (기본은 모든 지점)
- 키 회수: 즉시 차단 (관리자 페이지)

---

## 5. 엔드포인트 한눈에

전체 인터랙티브 문서: **https://voidanchae.com/api-docs**

| Method | Endpoint | Scope | 용도 |
|---|---|---|---|
| `GET` | `/api/v1/properties` | `properties:read` | 지점 목록 (propertyId 매핑) |
| `GET` | `/api/v1/properties/{id}/availability?from=&to=` | `properties:read` | 일자별 가용 |
| `GET` | `/api/v1/bookings?propertyId=&from=&to=&status=&source=` | `bookings:read` | 예약 목록 |
| `GET` | `/api/v1/bookings/{id}` | `bookings:read` | 예약 단건 |
| `POST` | `/api/v1/cleanings` | `cleanings:write` | 청소 생성 (멱등) |
| `GET` | `/api/v1/cleanings?propertyId=&from=&to=&status=` | `cleanings:read` | 청소 목록 |
| `GET` | `/api/v1/cleanings/{id}` | `cleanings:read` | 청소 단건 |
| `PATCH` | `/api/v1/cleanings/{id}` | `cleanings:write` | 청소 수정 (본인 것만) |
| `DELETE` | `/api/v1/cleanings/{id}` | `cleanings:write` | 청소 삭제 (본인 것만) |

---

## 6. 핵심 동작 규칙

### 멱등성

청소 POST 시 `externalId` 는 스테이폴리오 측 고유 ID. 같은 ID 재전송 → update (200). 네트워크 재시도 안전.

```http
POST /api/v1/cleanings
{
  "propertyId": "uuid-of-안온재",
  "date": "2026-06-05",
  "externalId": "stayfolio-cleaning-12345",
  "externalCleanerName": "김청소",
  "externalCleanerPhone": "010-1234-5678",
  "status": "pending"
}
```

같은 요청 재전송 → 같은 행 update, 201 대신 200 반환.

### First-Write-Wins 충돌 처리

같은 (propertyId, date) 슬롯에 우리 호스트가 이미 청소 만들었거나 다른 파트너가 점유한 상태에서 POST 시:

```http
HTTP/1.1 409 Conflict
{
  "error": "Conflict",
  "code": "slot_already_claimed",
  "existing": { ... 기존 청소 정보 ... }
}
```

→ 양쪽 시스템 모두 "먼저 만든 사람 우선" 정책 합의 필요.

### 청소부 풀 (담당 청소부 배정)

두 방식 중 하나로 청소부 지정:

| 방식 | 컬럼 | 용도 |
|---|---|---|
| **voidanchae 공유 풀** | `cleanerId` (UUID) | voidanchae 등록된 청소부에게 배정 |
| **스테이폴리오 자체 풀** | `externalCleanerName` + `externalCleanerPhone` | 스테이폴리오만의 청소부 |

두 컬럼 동시 사용 안 함. 응답에서는 `cleanerSource: 'internal' | 'external'` 로 구분.

### 본인 청소만 수정/삭제

PATCH/DELETE 는 본인 파트너가 만든 청소 (`externalSource` 일치) 만 가능. 다른 파트너/내부 청소는 403. **Cross-tenant write 방지**.

---

## 7. 합의 필요한 사항 (회의 안건)

### 핵심 결정 (반드시 합의)

| # | 안건 | voidanchae 제안 | 결정 |
|---|---|---|---|
| Q1 | 청소부 풀 방식 | 양사 모두 가능 (스테이폴리오 자체 풀 + voidanchae 공유 풀 모두 사용) | ☐ |
| Q2 | 충돌 처리 | First-write-wins. 양사 모두 거리낌 없이 push, 409 받으면 기존 데이터 확인 후 자기 시스템 갱신 | ☐ |
| Q3 | 청소 일정 push 타이밍 | 체크아웃 확정 즉시 또는 미리 N일 전 | ☐ |
| Q4 | 청소 완료 알림 | voidanchae 측 청소부가 완료하면 status='done' + completedAt 세팅. 스테이폴리오는 polling 으로 확인 | ☐ |

### 운영 디테일

| # | 안건 | voidanchae 제안 | 결정 |
|---|---|---|---|
| Q5 | externalId 형식 | 스테이폴리오 측 임의 — UUID/숫자 모두 OK (최대 200자) | ☐ |
| Q6 | polling 주기 | 청소/예약 5분, 가용성 1시간 권장 | ☐ |
| Q7 | 예약 변경/취소 | Beds24 sync 통해 자동 반영 (별도 webhook 불필요) | ☐ |
| Q8 | 에러 재시도 | 5xx 응답 시 exponential backoff (1s, 5s, 30s). 4xx 는 재시도 안 함. | ☐ |
| Q9 | 테스트 환경 | 별도 sandbox 만들 것 vs production 에서 test 키로 검증 | ☐ |
| Q10 | Go-live 일정 | 키 발급 후 1-2주 테스트, 그 후 단계적 (1개 지점 → 4개 지점) | ☐ |

---

## 8. 일정 제안

```
W0 (이번 주)  ─ 통합 스펙 확정 (이 미팅)
W1            ─ 스테이폴리오: 통합 코드 작성
                voidanchae: test 키 발급, 가용성 모니터링
W2            ─ 양사 sandbox 테스트 (안온재 1개 지점)
                edge cases 검증 (충돌, 재시도, 취소)
W3            ─ Production go-live (안온재)
W4+           ─ 운와당, 화연재, 도원재 순차 활성화
```

---

## 9. 기술 자료

| 자료 | URL |
|---|---|
| 인터랙티브 API 문서 (Swagger UI) | https://voidanchae.com/api-docs |
| OpenAPI 3.0 스펙 (YAML 다운로드) | https://voidanchae.com/v1-api.openapi.yaml |
| 키 발급 페이지 (voidanchae 내부) | https://voidanchae.com/admin/api-clients |

---

## 10. 미팅 후 액션 아이템 (템플릿)

- [ ] (voidanchae) test 키 발급 후 안전 채널로 전달
- [ ] (스테이폴리오) propertyId 매핑 테이블 작성
- [ ] (스테이폴리오) externalId 형식 확정 + 첫 청소 POST 시도
- [ ] (양사) 첫 충돌 케이스 시나리오 합의
- [ ] (양사) Go-live 일정 확정 + 점진적 롤아웃 계획

---

## 부록 A — Sample 요청/응답

### A-1. 지점 매핑 (첫 통신)

```bash
GET /api/v1/properties
Authorization: Bearer vd_live_***
```

```json
{
  "properties": [
    { "id": "uuid-1", "name": "안온재",   "timezone": "Asia/Seoul", "beds24PropId": "12345", "maxGuests": 4 },
    { "id": "uuid-2", "name": "운와당",   "timezone": "Asia/Seoul", "beds24PropId": "67890", "maxGuests": 6 },
    { "id": "uuid-3", "name": "화연재",   "timezone": "Asia/Seoul", "beds24PropId": "11111", "maxGuests": 4 },
    { "id": "uuid-4", "name": "도원재",   "timezone": "Asia/Seoul", "beds24PropId": "22222", "maxGuests": 8 }
  ]
}
```

### A-2. 청소 push

```bash
POST /api/v1/cleanings
Authorization: Bearer vd_live_***
Content-Type: application/json

{
  "propertyId": "uuid-1",
  "date": "2026-06-05",
  "externalId": "stf-cleaning-2026-06-05-anon",
  "externalCleanerName": "김청소",
  "externalCleanerPhone": "010-1234-5678",
  "status": "pending",
  "notes": "체크아웃 11시 확정"
}
```

```http
HTTP/1.1 201 Created
```
```json
{
  "id": "uuid-cleaning",
  "propertyId": "uuid-1",
  "date": "2026-06-05",
  "status": "pending",
  "cleanerSource": "external",
  "cleanerName": "김청소",
  "cleanerPhone": "010-1234-5678",
  "externalSource": "stayfolio",
  "externalId": "stf-cleaning-2026-06-05-anon",
  "notes": "체크아웃 11시 확정",
  "completedAt": null,
  "hasIssue": false,
  "createdAt": "2026-05-12T03:00:00.000Z"
}
```

### A-3. 청소 슬롯 충돌

```bash
POST /api/v1/cleanings
{ ...같은 propertyId, date 인데 다른 externalId ... }
```

```http
HTTP/1.1 409 Conflict
```
```json
{
  "error": "Conflict",
  "code": "slot_already_claimed",
  "existing": { ...이미 존재하는 청소 정보... }
}
```

→ 스테이폴리오 측은 `existing` 보고 본인 시스템에 매핑하거나 호스트와 협의.

### A-4. 가용성 조회

```bash
GET /api/v1/properties/uuid-1/availability?from=2026-06-01&to=2026-06-10
```

```json
{
  "propertyId": "uuid-1",
  "from": "2026-06-01",
  "to": "2026-06-10",
  "days": [
    { "date": "2026-06-01", "available": true,  "bookingId": null },
    { "date": "2026-06-02", "available": false, "bookingId": "evt-..." },
    { "date": "2026-06-03", "available": false, "bookingId": "evt-..." },
    { "date": "2026-06-04", "available": true,  "bookingId": null },
    ...
  ]
}
```
