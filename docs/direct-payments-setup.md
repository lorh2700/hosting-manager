# 직접 예약: Beds24 + Toss + PayPal REST API

예약 화면은 현재 사이트를 사용한다. 날짜·성인 인원 선택 시 Beds24 `/inventory/rooms/offers`에서 총 숙박요금을 조회하며, 주문 생성과 결제 시작 시 다시 조회한다. 클라이언트가 전달한 금액은 사용하지 않는다.

## 구현한 흐름

1. 날짜·인원 선택 → Beds24 판매 가능한 지정 offer의 KRW 요금 표시.
2. 예약자 정보 입력 → 서버에서 견적 저장(5분 유효). PayPal은 설정된 환율로 계산한 USD 금액과 원화 원가를 함께 표시.
3. 취소 규정 동의 → 요금 재검증 → `checkAvailability: true`로 Beds24 임시 black 차단 생성(15분).
4. 국내 카드는 Toss SDK, PayPal은 REST Orders v2로 생성한 PayPal 보안 페이지로 이동.
5. 고객 복귀 후 저장된 결제 ID로 서버 조회 → 금액·통화·주문 ID 검사 → 서버 capture/승인.
6. 결제 완료를 재조회한 뒤 같은 Beds24 차단을 confirmed로 변경하고 다시 확인 → 플랫폼 Booking/Event 및 청소 일정 반영.
7. `/admin/payments`의 전액 환불 → PayPal capture refund 또는 Toss 취소 → 결제사 환불 완료 확인 → Beds24 취소 및 플랫폼 예약·일정 정리.

PayPal은 토스를 경유하지 않는다. `TOSS_PAYPAL_*`는 사용하지 않는다. 기존 토스 경유 PayPal 주문이 있다면 모두 정산·환불한 뒤 전환해야 한다.

## 배포 준비

운영 활성화 전에 다음 마이그레이션을 순서대로 적용한다. 이미 적용된 SQL은 반복 실행하지 않는다.

- `prisma/migrations/20260912010000_checkout_orders/migration.sql`: 주문 원장, 서버 전용 RLS.
- `prisma/migrations/20260912020000_paypal_direct/migration.sql`: PayPal 환불 ID·요청 시점. 기존 예약 변경/삭제 없음.

Prisma 이력을 관리하는 환경에서는 `npx prisma migrate deploy`를 사용한다. 기존에 SQL Editor로 적용했다면 먼저 마이그레이션 이력을 확인한다. 이 변경 작업은 운영 DB에 마이그레이션을 자동 적용하지 않는다.

```dotenv
CHECKOUT_ENABLED=false
CHECKOUT_MODE=test
CHECKOUT_SITE_URL=https://voidanchae.com
# 플랫폼 Property UUID를 쉼표로 구분. Beds24 ID나 slug가 아니다.
CHECKOUT_PROPERTY_IDS=
CHECKOUT_BEDS24_OFFER_ID=
# 선택 offer.price가 세금·청소비 등 필수 요금을 모두 포함함을 확인한 뒤 true
CHECKOUT_PRICE_INCLUDES_ALL_FEES=false
# 실제 취소·환불 규정과 취소 문의 연락처
CHECKOUT_TERMS=
# 1 USD당 KRW. 판매자가 정한 환율을 견적에 고정하며 임의 기본값은 없다.
CHECKOUT_KRW_PER_USD=
TOSS_CLIENT_KEY=
TOSS_SECRET_KEY=
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_ENV=sandbox
CRON_SECRET=
```

- Netlify Production의 Functions 범위에 설정한다. 스케줄 함수에도 CRON_SECRET과 결제 키가 적용되어야 한다.
- 운영은 `CHECKOUT_MODE=live`, `PAYPAL_ENV=live`. 테스트는 `test`, `sandbox`. 두 설정이 다르면 PayPal 결제를 차단한다.
- PayPal만 설정해도 토스 키 없이 PayPal 결제가 가능하다. 토스는 개별 API 연동 키를 사용한다.
- 키 외에 허용 숙소, offer, 환율, 약관, CRON_SECRET 설정까지 완료해야 온라인 결제수단이 표시된다.
- 가격 미리보기에도 활성 숙소, Beds24 연결, 지정 offer 및 총액 포함 확인이 필요하다. 설정 오류나 판매 불가 시 임의 가격을 보여주지 않는다.
- Beds24는 원화 숙소를 지원한다. 성인 인원으로 조회하며 아동·유아별 요금, 쿠폰, 추가 상품은 지원하지 않는다.
- Beds24 자체 결제 요청/자동 청구가 중복 실행되지 않도록 해당 직접 예약의 자동화 규칙을 확인한다. PG 결제 원장은 플랫폼에 저장하며 Beds24 invoice payment 항목은 자동 기장하지 않는다.

## 웹훅·복구

Toss PAYMENT_STATUS_CHANGED:
`https://voidanchae.com/api/public/checkout/webhook`

PayPal Live/Sandbox 앱에서 아래 URL에 CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.PENDING, PAYMENT.CAPTURE.DENIED, PAYMENT.CAPTURE.REFUNDED를 등록:
`https://voidanchae.com/api/public/checkout/paypal/webhook`

웹훅은 재조회 계기로만 사용한다. 본문의 금액·결제 상태를 신뢰하지 않으며 저장된 주문 ID로 결제사 API를 인증 조회한다. 웹훅만으로 새 승인을 실행하지 않는다. 고객 복귀로 승인 의사가 기록된 `approving` 상태만 재처리할 수 있다. 주문을 찾을 수 없는 이벤트는 무시한다. 고객이 복귀하지 않고 승인만 한 경우 capture하지 않으며 기한 후 객실 확보가 해제된다.

매분 `payments-cron` → `payments-background` → 인증된 `/api/cron/payments`가 미완료 주문을 처리한다. 브라우저는 처리 상태를 조회하고, 관리자는 상태 재확인을 실행할 수 있다. 복구 스케줄은 새 결제를 비활성화해도 계속 실행된다.

- DB lease로 시작·승인·환불·만료 처리를 직렬화한다.
- PayPal 생성·capture·환불에 작업별 고정 PayPal-Request-Id를 보낸다. 응답 유실은 먼저 결제사 상태를 조회한다.
- PayPal 주문 ID를 DB에 저장하기 전에는 승인 링크를 고객에게 반환하지 않는다.
- capture PENDING, 환불 PENDING, 결제사 조회 장애에서는 객실을 해제하지 않는다.
- 환불 ID를 저장해 대기 중인 환불은 조회만 한다. 불확실한 capture/환불을 5시간 넘게 재시도하지 않고 `review`로 전환한다.
- 부분환불, 금액·주문 불일치는 `review`로 남긴다. 자동 부분환불·위약금 계산은 지원하지 않는다.
- 결제 완료 후 Beds24 통신 실패는 `fulfilling`에서 복구한다. 객실 확보가 사라졌다면 전액 환불 대기로 전환한다.
- 고객 토큰은 DB에 해시로, 브라우저에는 sessionStorage에 저장한다. PayPal 복귀 시 같은 브라우저가 필요하다.
- 외부 대시보드에서 수행한 취소·환불은 웹훅이 주문을 식별하지 못하면 관리자 상태 재확인이 필요하다.

## 검증과 운영 전 확인

자동 테스트는 Beds24 가격 사용·가격 변경, 금액 위변조, PayPal 주문 생성/중복 시작, 승인·응답 유실, 만료, pending capture, 전액/부분/pending 환불, 환경 불일치, 승인 URL 검증을 모의 서버·DB로 확인한다. 실제 결제사 결제와 운영 DB 경쟁을 증명하지 않는다.

운영 활성화 전 Sandbox 구매자와 별도 Beds24 테스트 객실로 결제창 → 승인 → 예약 확정 → 전액 환불 → 재고 복구를 검증한다. 결제는 Sandbox여도 Beds24 차단은 실제 생성되므로 테스트 객실을 사용한다. 브라우저 닫힘, 모바일 복귀, 동일 날짜 동시 시도, 웹훅 유실·크론 복구도 확인한다.

일회성 인증 점검은 환경변수가 있는 곳에서 `node scripts/check-paypal-auth.mjs`로 실행한다. 이제 사이트 빌드에 운영 인증 테스트를 강제로 연결하지 않는다.

## 공식 문서

- [PayPal Orders](https://developer.paypal.com/api/orders/v2)
- [PayPal Refund](https://developer.paypal.com/api/payments/v2/captures-refund)
- [PayPal Idempotency](https://developer.paypal.com/reference/guidelines/idempotency/)
- [Beds24 OpenAPI](https://beds24.com/api/v2/apiV2.yaml)

롤백은 CHECKOUT_ENABLED=false로 신규 결제를 중단한다. 미완료 주문이 남아 있으면 비밀 키·환경·복구 스케줄을 유지한다. 주문 원장과 마이그레이션을 삭제하지 않는다.
