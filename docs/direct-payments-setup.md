# 직접 예약: Toss + PayPal

구현한 흐름: 숙소 일정·성인 인원·결제수단 선택 → Beds24 지정 offer의 요금 조회 → 최종 금액·취소 규정 확인 → 재조회 후 재고 검사(checkAvailability)를 동반한 임시 black 차단 → Toss 인증/서버 승인 → 동일 Beds24 항목을 confirmed로 전환·조회 확인 → Booking/Event 저장.

PayPal도 **토스페이먼츠 해외 간편결제 MID**로 처리한다. PayPal REST API 키를 직접 사용하는 구현이 아니다. SDK v2 `payment()`용 **API 개별 연동 키**가 필요하며, 위젯 전용 키는 사용하지 않는다.

## 배포 전

1. Supabase SQL Editor에서 `prisma/migrations/20260912010000_checkout_orders/migration.sql`을 실행한다. 운영 DB에는 아직 적용하지 않았다. 기존 예약은 변경하지 않는다.
2. 토스 계정에서 국내 결제용 테스트 키와 PayPal용 테스트 키를 각각 준비한다. PayPal 테스트용 구매자 계정도 준비한다.
3. 아래 환경변수를 Netlify에 등록한다. 키는 대화나 Git에 넣지 않는다.
4. 먼저 별도 Beds24 테스트 숙소/객실을 연결한 플랫폼 Property UUID만 허용한다. **토스 테스트 키도 Beds24에는 실제 차단/예약을 생성한다. 운영 객실로 테스트하지 않는다.**
5. 테스트 배포 후 웹훅과 예약 복구 스케줄이 작동하는지 확인한다. 초기 라이브 배포는 `CHECKOUT_ENABLED=false`로 한다.
6. PG 숙박업·해외카드·PayPal 계약/심사 및 실결제 검증 후 운영 키/운영 숙소로 전환한다. 기존 테스트 주문을 모두 정리한 후 mode/키를 바꾼다.

```dotenv
CHECKOUT_ENABLED=false
CHECKOUT_MODE=test
CHECKOUT_SITE_URL=https://실제-예약-도메인
# 쉼표로 나눈 플랫폼 Property UUID. slug나 Beds24 ID가 아니다.
CHECKOUT_PROPERTY_IDS=
# 공개 판매에 사용할 Beds24 offer ID. KRW 숙소만 지원.
CHECKOUT_BEDS24_OFFER_ID=
# 선택 offer.price에 청소비/세금/필수 추가요금까지 모두 포함된 것을 확인한 뒤 true.
CHECKOUT_PRICE_INCLUDES_ALL_FEES=false
# 실제 적용할 한국어/영어 취소·환불 규정 및 취소 문의 연락처. 임의 기본 정책 없음.
CHECKOUT_TERMS=
# 1 USD당 KRW. 판매자가 정한 환율을 주문 생성 시 고정. 자동 시장환율 아님.
CHECKOUT_KRW_PER_USD=
TOSS_CLIENT_KEY=
TOSS_SECRET_KEY=
TOSS_PAYPAL_CLIENT_KEY=
TOSS_PAYPAL_SECRET_KEY=
# 기존 값 유지
CRON_SECRET=
```

`test_ck_…` / `test_sk_…`가 테스트, `live_ck_…` / `live_sk_…`가 운영 키다. 국내·PayPal 키는 서로 맞는 MID의 쌍이어야 한다. NEXT_PUBLIC 접두사는 필요 없다. 서버가 시작 요청에 해당 공개 clientKey만 반환한다.

이미 사용하는 Beds24 토큰에는 `read:inventory`, `read:properties`, `read:bookings`, `write:bookings`, 필요한 개인정보/재무 범위가 있어야 한다. 토큰 scope가 부족하면 가격 조회/예약 처리가 실패하며 결제를 시작하지 않는다.

## 요금·환불 규칙

- Beds24 `/inventory/rooms/offers`의 지정 offer만 사용한다. 다른 offer로 임의 대체하거나 0원/판매 불가를 허용하지 않는다.
- 성인 인원으로 요금을 조회한다. 아동/유아별 요금 선택 및 추가 상품/쿠폰은 이번 범위에 포함하지 않는다.
- Offer API가 필수 별도 추가금 전체를 설명하지 않으므로, 부킹엔진 화면의 총액과 API price를 대조해 **모든 필수 요금을 포함한 전용 offer**를 설정해야 한다. 일치하지 않으면 활성화하지 않는다.
- 국내 카드/계약된 간편결제: KRW. 해외카드 옵션: PG 해외카드 계약 필요.
- PayPal: USD. 원화 원가와 설정 환율을 고정한 소수점 2자리 최종 USD 금액을 고객에게 보여준다. PG 환전/정산 요율과 동일하다는 뜻이 아니다.
- 모든 예약은 전액 결제. 정책에 따른 자동 위약금 계산, 부분 환불, 분할 결제는 미구현이다.
- 고객 취소는 표시된 연락처로 요청하고 관리자가 정책을 확인한다. `/admin/bookings` → **온라인 결제·환불 관리** → 전액 환불·예약 취소. 실제 환불 요청은 명시적인 확인 버튼을 눌러야 실행된다.
- 기존 예약 취소/날짜 변경 API는 결제 연동 예약의 우회를 막는다. Beds24/토스 대시보드에서 직접 변경하면 외부 변경 상태를 따로 확인해야 한다. 특히 부분 환불은 수동 확인 상태로 표시한다.
- 결제 원장은 void anchae이다. Beds24의 자체 결제 요청/자동 청구가 중복 실행되지 않도록 온라인 직접 예약의 자동화 조건을 확인한다. 이번 구현은 Beds24 invoice payment 항목에 PG 결제를 기장하지 않는다.

## 웹훅·복구

- Toss 국내/PayPal 양쪽 MID의 PAYMENT_STATUS_CHANGED 웹훅 URL:
  `https://실제-예약-도메인/api/public/checkout/webhook`
- 웹훅의 상태/금액을 신뢰하지 않는다. 서버 시크릿 키로 Toss 주문을 다시 조회한다. 고객이 시작하지 않은 승인을 웹훅만으로 실행하지 않는다. 이미 승인 의사가 기록된 `approving` 주문은 동일 멱등키로 재처리할 수 있다.
- 조회 견적: 5분. 객실 차단 후 결제 대기: 15분. 브라우저 닫힘/인증 취소도 기한이 지난 뒤 결제 상태를 확인하고 해제한다. 네트워크 장애 시 즉시 해제되지 않고 복구 대기한다.
- `payments-cron` → 인증된 `payments-background` → `/api/cron/payments`가 작은 배치로 미완료 주문을 처리한다. 매분 실행하며 DB lease로 중복 작업을 막는다.
- Beds24 생성 응답이 유실되면 custom1의 주문 마커로 조회 복구한다. 같은 주문의 생성 POST를 무작정 재시도하지 않는다. 결과를 끝내 확인하지 못하면 `review`로 남긴다. 관리자/Netlify 로그에서 정기 확인해야 하며, 운영자 별도 푸시 알림은 아직 없다.
- Toss 승인 응답이 유실되면 주문 ID 조회로 이미 승인됐는지 확인한다. 승인·환불 요청에는 고정 멱등키를 사용한다.
- 결제 성공 후 Beds24 확정 통신 실패: `fulfilling`에서 재처리. 실제 객실 차단이 없어졌거나 예약과 불일치하면 전액 환불 대기로 전환한다. 환불 이후 재고 해제 실패도 복구 대기로 남는다.
- Supabase checkout_orders는 RLS를 켠 서버 전용 테이블. 고객은 256-bit 무작위 토큰으로 자기 주문만 조회한다. 토큰은 해시만 DB에 저장하며, 브라우저 세션에 보관한다. 결제 복귀는 같은 브라우저를 사용해야 한다.

## 검증

자동 테스트: 금액/통화/주문 식별 검증, USD 센트 계산, 매진·다른 offer 거절, 고객 토큰, 중복 시작, 승인 유실 복구, 미결제 해제, 유료 예약 재처리, 전액 환불 및 lease 경쟁.

실제 키/테스트 DB가 준비되면 반드시 수행:
1. 별도 테스트 객실에서 국내 카드와 PayPal sandbox 각각 승인 → Beds24 confirmed → 플랫폼 예약 확인.
2. 다른 고객 세션으로 같은 날짜 동시 결제 시도 → 한 객실만 확보됨을 확인.
3. 모바일 카드 앱/PayPal 인증 후 원래 브라우저로 복귀 확인.
4. 결제 취소·브라우저 종료 → 만료 후 Beds24 차단 해제 확인.
5. 전액 환불 → Toss CANCELED → Beds24 cancelled → 청소 일정 정리 확인.
6. 강제 통신 실패/크론 재실행으로 재처리 확인. 유실된 웹훅과 인위적 부분환불의 수동 확인 상태도 확인.

현재 자동 테스트는 외부 응답과 DB를 모의한 것으로 실제 PG 승인/DB 트랜잭션 경쟁/Beds24 재고 동작을 증명하지 않는다. 키 등록만으로 바로 라이브 활성화하지 않는다.

## 공식 문서

- [Toss PayPal 연동](https://docs.tosspayments.com/guides/v2/payment-window/integration-paypal)
- [Toss SDK v2 payment](https://docs.tosspayments.com/sdk/v2/js/payment)
- [Toss 결제 API](https://docs.tosspayments.com/reference)
- [Beds24 OpenAPI](https://beds24.com/api/v2/apiV2.yaml)

롤백: 새 결제 유입은 CHECKOUT_ENABLED=false로 중단할 수 있다. 미완료 결제/차단이 남아 있다면 복구 크론을 중단하지 말고 끝까지 처리해야 한다. 코드/스키마를 제거하기 전에 pending 주문과 환불을 모두 정리한다. 금융 기록 테이블은 삭제하지 않는다.

복구 크론은 CHECKOUT_ENABLED와 별개로 결제 비밀 키가 설정되어 있으면 실행된다. 처리 중인 주문이 있는 동안 키·CHECKOUT_MODE·CRON_SECRET을 제거하거나 교체하지 않는다. 승인 요청을 시작한 주문은 `approving`으로 남겨, 응답이 불확실하면 15분이 지나도 객실을 해제하지 않는다. 같은 멱등 키로 승인 결과를 복구한 후 예약 확정 또는 확인된 결제 실패에 따라 처리한다.
