# 안정화 & 단계적 서비스 분리 설계서

> 대상: hosting-manager (void-anchae) — Next.js 15 모놀리스, Netlify 배포, Prisma + Supabase Postgres
> 작성일: 2026-06-07
> 목표: **풀 MSA 전환이 아니라**, 불안정 요인을 제거하면서 필요한 부분만 단계적으로 분리(Strangler 패턴)

---

## 0. 결론 요약

| 단계 | 작업 | 기간(예상) | 효과 |
|------|------|-----------|------|
| Phase 0 | 안정화 핫픽스 (에러 처리·멱등성·로깅) | 1주 | 즉시 장애 감소 |
| Phase 1 | 도메인 모듈 경계 정리 (코드만, 배포 동일) | 1~2주 | 분리 준비 완료 |
| Phase 2 | **Sync Worker 분리** (Beds24 + iCal 동기화 독립 서비스) | 2~3주 | 가장 큰 안정성 개선 |
| Phase 3 | Notify를 이벤트 기반으로 (아웃박스 패턴) | 1~2주 | 알림 실패 격리·재시도 |
| Phase 4 | 트래픽/팀 성장 시 도메인 서비스 분리 검토 | 미래 | 필요할 때만 |

현재 규모에서 풀 MSA는 **비추천**: 단일 DB·소규모 팀에서 서비스를 쪼개면 분산 트랜잭션, 서비스 간 장애 전파, 배포·모니터링 비용이 안정성을 오히려 해친다. 불안정의 실제 원인은 아래 진단 참고.

---

## 1. 현재 아키텍처

```
Netlify
├─ Next.js 앱 (UI + /api/* 라우트)
│   └─ /api/beds24/sync-all (maxDuration=60s) ← 동기화 본체
├─ Scheduled Functions (26s 제한)
│   ├─ beds24-sync-cron (*/5분) ──→ beds24-sync-background (15분) ──→ /api/beds24/sync-all
│   └─ beds24-messages-cron (*/15분) ──→ beds24-messages-background ──→ /api/beds24/messages
└─ Supabase Postgres (단일 Prisma 스키마) + Supabase Realtime (웰컴패드 채팅)
```

도메인: 인증 / 예약·동기화(Beds24, iCal) / 청소 / 메시징 / 투어 / 웰컴패드 / 어드민 / v1 공개 API

### 핵심 의존성

```
sync-engine ──→ beds24.ts(토큰), notify.ts(청소 알림), prisma(Event·Cleaning·SyncLog)
cleanings API ──→ notify.ts
welcomepadChat ──→ Supabase PostgREST (별도 테이블, 격리 양호)
tours ──→ booking과 느슨한 링크(FK 없음, 격리 양호)
```

---

## 2. 불안정 요인 진단 (Phase 0 대상)

| # | 문제 | 위치 | 위험 | 조치 |
|---|------|------|------|------|
| 1 | iCal fetch 실패가 unhandled throw로 전체 sync 중단 가능 | `lib/sync-engine.ts:134` | **높음** | 채널 단위 try/catch, 실패해도 다음 채널 계속 |
| 2 | beds24.ts의 throw를 호출처(sync-engine)가 catch 안 함 | `lib/beds24.ts:52,139` | **높음** | property 단위 격리 + 에러를 SyncLog에 기록 |
| 3 | SyncLog를 sync 완료 후에만 create → 실패 시 기록 누락 | `lib/sync-engine.ts:559` | 중간 | 시작 시 `running` 레코드 생성, 종료 시 update |
| 4 | sync 루프 내 `findFirst` N+1 쿼리 | `lib/sync-engine.ts:471-516` | 중간 | 사전 일괄 조회 후 Map 매칭 |
| 5 | Beds24 booking 생성 멱등성 부족 (중복 생성 가능) | `app/api/beds24/bookings` | 중간 | beds24BookingId unique 제약 + upsert |
| 6 | 미할당 Cleaning 자동 삭제 — 예약 변동 시 데이터 소실 위험 | `lib/sync-engine.ts:297-309` | 중간 | soft-delete(status=cancelled) 권장 |
| 7 | `/api/beds24/sync-all` 60초 제한 — property 수 증가 시 타임아웃 | route maxDuration | 중간 | Phase 2에서 근본 해결, 임시로 property 단위 분할 호출 |
| 8 | 429 재시도 1회뿐, 최대 30초 대기 | `lib/beds24.ts:118-127` | 낮음 | Phase 2의 큐 기반 재시도로 해결 |

**Phase 0 체크리스트** (배포 변경 없음, 코드 수정만):

- [ ] sync-engine: 채널/property 단위 에러 격리 (`Promise.allSettled` 또는 개별 try/catch)
- [ ] SyncLog: 시작 시 생성 → 종료 시 success/failed update (실패도 기록)
- [ ] Beds24 booking upsert 멱등성 (`beds24BookingId` unique)
- [ ] Cleaning 삭제 → status 변경으로 전환
- [ ] N+1 제거 (일괄 조회)
- [ ] Sentry(또는 Netlify log drain) 도입 — cron 경로 에러 알림

---

## 3. Phase 1 — 도메인 모듈 경계 정리

배포는 그대로, `lib/`를 도메인 모듈로 재구성. 분리의 사전 작업이며 그 자체로 유지보수성 향상.

```
lib/
├─ core/          # prisma, auth, rateLimit, utils, constants
├─ booking/       # sync-engine, beds24, ical 파싱  ← Phase 2 분리 후보
├─ cleaning/      # cleaning 도메인 로직 (현재 API 라우트에 산재)
├─ notification/  # notify, solapi, email           ← Phase 3 분리 후보
├─ messaging/     # beds24 메시지, welcomepadChat/Realtime
└─ tour/          # 투어 (이미 격리 양호)
```

규칙:

1. 모듈 간 직접 import 금지 — 각 모듈의 `index.ts`(공개 인터페이스)만 통해 호출
2. cross-domain 호출은 함수 호출 → **도메인 이벤트 형태로 추상화** (예: sync-engine이 notify를 직접 부르지 않고 `onCleaningCreated(cleaning)` 훅 발행). Phase 3에서 큐로 교체할 자리.
3. API 라우트는 얇게 — 비즈니스 로직은 모듈로 이동

---

## 4. Phase 2 — Sync Worker 분리 (핵심)

### 왜 이것부터인가

- 동기화는 외부 API(Beds24, iCal) 의존 + 장시간 실행 + 주기 실행 → 모놀리스 안에서 가장 큰 불안정 요인
- 현재도 cron→background→API 3단 체인으로 어설프게 분리돼 있음 (60초 제한에 갇힘)
- DB는 공유해도 됨 — sync는 쓰기 주체가 명확(Event, Cleaning, SyncLog)해서 충돌 위험 낮음

### 목표 구조

```
┌─ hosting-manager (Netlify, 기존 유지)
│   UI + API. 동기화 코드 제거, "지금 동기화" 버튼은 큐에 job 발행만
│
├─ sync-worker (신규, Railway/Fly.io/Render 등 long-running)
│   ├─ 스케줄러: node-cron (5분 sync, 15분 messages) — Netlify cron 체인 제거
│   ├─ 큐 컨슈머: property 단위 job 처리
│   ├─ 재시도: 지수 백오프, 429 시 rate-limit 존중하며 대기 (60초 제한 없음)
│   └─ 동시성 제어: Beds24 credit pool 기준 throttle
│
├─ 큐: pg-boss (추가 인프라 없이 기존 Postgres 사용) ← 권장
│        대안: Upstash QStash, BullMQ+Redis
│
└─ Supabase Postgres (공유 — 이 단계에서는 DB 분리 안 함)
```

### Job 설계

| Job | 발행 주체 | 단위 | 멱등성 키 |
|-----|----------|------|----------|
| `sync.property` | 스케줄러 / 수동 버튼 | property 1개 | propertyId + 시간창 |
| `sync.messages` | 스케줄러 | property 1개 | propertyId + 시간창 |
| `notify.cleaning` | sync-worker (Phase 3 선행 적용 가능) | 알림 1건 | cleaningId + type |

property 단위로 쪼개면: 한 property 실패가 다른 property에 영향 없음, 타임아웃 사실상 해소, 재시도 단위 명확.

### 마이그레이션 순서 (무중단)

1. sync-worker 저장소/배포 셋업, `lib/booking` 모듈 복사 (Phase 1 결과물 재사용)
2. pg-boss 테이블 추가 (기존 DB에 스키마 생성)
3. sync-worker가 스케줄 발행 + 소비 시작 — **이때 Netlify cron은 끈 상태로 병행 테스트**
4. SyncLog로 양쪽 결과 비교 검증 (1주)
5. Netlify cron 함수 4개 + `/api/beds24/sync-all` 제거
6. 메인 앱의 "수동 동기화"는 큐 발행 API로 교체

### 분리 기준선

- 메인 앱과 worker는 **DB로만 통신** (HTTP 호출 없음 → 서비스 간 장애 전파 차단)
- 코드 공유: prisma schema + `lib/booking`은 npm workspace(모노레포)로 공유 권장

---

## 5. Phase 3 — 알림 이벤트화 (아웃박스 패턴)

현재: sync-engine·cleanings API가 notify를 직접 호출 (best-effort, 실패 시 유실).

변경:

1. `NotificationOutbox` 테이블 추가 — 알림 발생 시 비즈니스 트랜잭션과 **같은 트랜잭션**으로 insert
2. sync-worker(또는 동일 worker 내 컨슈머)가 outbox를 폴링/구독해 Solapi/email 발송
3. 실패 시 재시도 + dead-letter 상태 기록 → 알림 유실 제로

별도 서비스로까지 분리할 필요는 없음 — sync-worker에 컨슈머로 동거시키면 충분.

---

## 6. Phase 4 — 향후 도메인 서비스 분리 (조건부)

아래 신호가 나타날 때만 검토:

| 신호 | 분리 후보 |
|------|----------|
| 투어 사업 규모 확대, 별도 팀 | tour-service (이미 FK 없는 느슨한 결합 — 분리 쉬움) |
| 웰컴패드 디바이스 수 증가, 실시간 부하 | welcomepad → Supabase Edge Functions |
| v1 공개 API 파트너 증가 | API Gateway + 독립 배포 |
| 청소업체 멀티테넌트화 | cleaning-service |

그 전까지는 "모놀리스 + sync-worker" 2-서비스 구조가 최적.

---

## 7. 인프라 선택지 비교 (sync-worker)

| 옵션 | 장점 | 단점 | 비용 |
|------|------|------|------|
| **Railway** (권장) | 배포 간단, cron+long-running 모두 지원 | — | ~$5/월 |
| Fly.io | 저렴, 리전 선택(nrt) | 설정 다소 복잡 | ~$3/월 |
| Render | 간단 | background worker는 유료 플랜 | $7/월~ |
| Supabase Edge Functions | 인프라 추가 없음 | 실행시간 제한, node-cron 불가 | 무료~ |

큐는 **pg-boss**가 최선: Redis 등 추가 인프라 없이 기존 Postgres로 at-least-once 보장, 재시도·스케줄링 내장.

---

## 8. 성공 지표

- SyncLog 실패율 < 1%, 실패 시 자동 재시도로 복구
- 동기화 타임아웃(60s 초과) 발생 0건
- property 1개 장애가 전체 sync를 막는 사례 0건
- 알림 유실 0건 (outbox 기준 추적 가능)
- 메인 앱 배포와 sync 배포의 독립 (서로 영향 없음)
