# Beds24 예약별 초대장 연결

## 상태

앱 연동 코드는 구현됨. 운영 배포, 환경변수 설정, Beds24 Auto Action 설정은 아직 적용하지 않음.
앱은 메시지를 직접 보내지 않는다. Beds24 예약 Info Item `VOID_INVITATION`에 전용 URL을 저장하고, 기존 Beds24 자동 메시지가 이를 삽입한다.

## 운영 적용 순서

1. `/guest/welcome/[token]` 페이지와 동기화 코드를 운영 사이트에 함께 배포한다.
2. 기존 예약 확정 Auto Action의 설정과 본문을 백업한다. 같은 메시지를 보내는 별도 규칙을 중복 생성하지 않는다.
3. 아래 변수를 운영에 설정한다. 시작일은 실제 전환 시각을 ISO 8601 형식과 시간대로 지정한다. 과거 예약 소급 발송을 원하지 않으면 과거 시각을 넣지 않는다.
   - `BEDS24_INVITATIONS_FROM=<실제 전환 시각, 예: YYYY-MM-DDTHH:mm:ss+09:00>`
   - `NEXT_PUBLIC_APP_URL=https://voidanchae.com`
   - 기존 `JWT_SECRET`, Beds24 예약 읽기/쓰기 API 권한을 사용한다.
4. Beds24 → Settings → Guest Management → Auto Actions에서 기존 확정 예약 메시지 본문에 아래 내용을 추가한다.

```text
숙박을 준비하실 수 있도록 고객님만의 초대장을 준비했습니다.
예약 일정과 숙소 안내를 아래 링크에서 확인해 주세요.
[BOOKINGINFOCODETEXT:VOID_INVITATION]
```

```text
Your personal invitation is ready.
View your stay details and arrival guide here:
[BOOKINGINFOCODETEXT:VOID_INVITATION]
```

5. 발송 대상은 확정 예약으로 제한하고 `VOID_INVITATION` Info Code가 존재할 때 발송되도록 조건을 추가한다. 링크가 동기화 뒤에 생기므로 Trigger Window를 동기화 지연/재시도를 포함하도록 설정한다. 기존 메시지가 이미 발송된 예약에 재발송되지 않도록 일회 발송 설정을 유지한다. 기존 규칙의 다른 조건과 채널별 발송 방식도 보존한다.
6. 먼저 테스트 예약 한 건으로 Info 탭에 실제 URL이 저장되는지, Beds24 메시지 미리보기에서 변수가 URL로 치환되는지, 이름·날짜와 모바일 화면이 맞는지 확인한다. 운영 게스트 대상으로 테스트 발송하지 않는다.
7. 그 다음 운영 자동 메시지를 활성화한다. 그룹 예약의 대표 예약/각 객실 발송 범위는 기존 Auto Action 설정을 유지하고 별도로 확인한다.

## 동작과 제한

- 새 초대장은 UUID와 만료 시각을 바이너리로 암호화한 95자 토큰을 사용한다. 전체 URL은 언어 쿼리를 포함해 140자다. 기존 JSON 암호화 링크도 계속 검증하며, 유효한 기존 링크는 동기화 시 유지한다. 손상된 링크는 적용 대상 예약의 다음 정상 동기화에서 새 링크로 교체한다.
- Beds24 예약 93464966에서 확인한 손상 링크 한 건은 SHA-256 정확 일치 복구 목록으로 기존 주소를 지원한다. 원본 토큰은 코드에 저장하지 않는다. 페이지는 원래 예약의 숙소 일치, 확정 상태, 체크아웃 후 30일 만료 검사를 동일하게 적용한다. 임의의 다른 손상 링크는 복구하지 않는다.

- 지원되는 게스트 안내 숙소의 신규 확정 예약만 처리한다. 문의·취소·차단·이름 없는 예약과 적용 시작일 이전 예약은 제외한다.
- Beds24 예약 생성 → 기존 동기화 실행 → 링크 Info Item 저장 → Beds24 Auto Action 순서이므로 즉시 발송이 아닌 동기화 및 Auto Action 실행 주기만큼의 지연이 있다.
- 언어 필드가 ko/en/ja/zh이면 사용하며, 미지정 또는 미지원 언어는 영어다. 게스트가 페이지에서 변경할 수 있다.
- 동일 예약의 유효 링크는 재사용한다. 다른 Info Item과 예약 정보는 수정하지 않는다. 취소/삭제 및 예약 변경은 로컬 동기화 후 페이지에 반영된다.
- 링크는 체크아웃 후 30일까지 유효하다. 체크아웃이 연장되어 기존 토큰 유효기간을 넘으면 Info Item URL을 교체한다. 이미 보낸 메시지의 URL 자체는 바뀌지 않는다.
- 예약 한 숙소당 동기화 1회에 최대 10건의 추가 조회/저장을 시도한다. 실패는 결과의 error에 남고 다음 동기화에서 다시 조회한다. 실패 응답에 이름·URL·API 응답 본문은 기록하지 않는다.
- 동시 동기화가 최초 Info Item을 동시에 생성할 수 있으므로 최종 중복 발송 방지는 Beds24 Auto Action 일회 발송 설정이 담당한다.
- 초대장 링크 동기화는 항상 실행되며 활성화 플래그는 사용하지 않는다. `BEDS24_INVITATIONS_FROM`은 예약 생성 시각 기준으로 소급 적용을 제한하며 필수다. 메시지 발송을 중단하려면 Beds24 Auto Action에서 처리한다.

## 근거

- https://wiki.beds24.com/index.php/API_V2.0 — POST /bookings로 예약 Info Item 추가/수정
- https://wiki.beds24.com/index.php/Template_Variables — `[BOOKINGINFOCODETEXT:infoCode]`
- https://wiki.beds24.com/index.php/Auto_Actions — Info Code 조건과 자동 메시지
