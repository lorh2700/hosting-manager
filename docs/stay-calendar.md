# 공개 예약 달력

공개 숙소 상세 API는 숙소 정보만 반환합니다. 자체 DB의 이벤트/예약 목록을 판매 가능 날짜로 해석하지 않습니다.

`GET /api/public/stay-calendar?propertyId=...&start=YYYY-MM-DD&end=YYYY-MM-DD`는 서버에 저장된 객실 연결 정보로 Beds24의 `/inventory/rooms/calendar`와 `/properties`를 조회합니다. 재고, 최소/최대 숙박, 체크인/체크아웃 제한과 `firstNight`/`stayThrough` 전략을 적용합니다. 조회 범위는 최대 63일이며 과거 날짜는 제외합니다. 응답은 캐시하지 않고 월 이동, 재시도, 창 재활성화 시 갱신합니다. 누락/실패한 데이터는 선택 불가로 처리합니다.

달력에서 선택 가능한 날은 최종 판매 견적이 아닙니다. 요금제별 인원·사전 예약·특별 기간 등의 추가 조건은 선택한 전체 일정에 대해 `/inventory/rooms/offers`로 확인합니다. 요금을 확인하지 못하면 예약 진행을 차단하고, 결제 직전에도 요금과 객실 확보를 재검증합니다. 결제가 꺼진 예약 요청도 동일한 Beds24 요금 검증 후 접수하며, 접수 자체가 객실 확정을 의미하지 않습니다.

배포 시 기존 `BEDS24_REFRESH_TOKEN`, 객실의 Beds24 연결 ID, `CHECKOUT_BEDS24_OFFER_ID`를 사용합니다. 토큰에 객실 설정·재고·요금 읽기 권한이 필요합니다. Beds24의 재고나 숙박 제한 설정 자체는 변경하지 않습니다.

공식 정의: [Beds24 API](https://beds24.com/api/v2/), [달력 입퇴실 제한](https://wiki.beds24.com/index.php/Setting/calendar2override).
