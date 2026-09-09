# 오늘의 청소 알림 계획

기존 PWA에 Web Push를 추가한다. 현재 단계는 계획이며 푸시 전송은 구현하지 않는다.

- 기본 오전 9시(KST), 개인별 변경 가능. 담당자는 본인 배정, 매니저는 관리 숙소의 오늘 일정 요약을 받는다. 일정이 없으면 보내지 않는다.
- 알림을 누르면 오늘 정비/본인 청소 화면으로 이동한다. 로그인 만료 시 로그인 후 원래 화면으로 돌아온다.
- 화면: 알림 켜기, 홈 화면 설치 안내, 시간 설정, 테스트 알림, 최근 알림함. 기존 Solapi 설정은 유지하며 자동으로 끄지 않는다.
- iOS 16.4 이상은 홈 화면에 추가한 웹 앱에서 사용자가 알림 켜기를 눌러 권한을 허용해야 한다. Android는 지원 브라우저에서 권한 허용 후 사용한다.
- PushSubscription(userId, endpoint unique, keys, device, lastSeen), NotificationPreference(userId, enabled, timeKst), NotificationDelivery(userId, date, kind, status, attempts, nextRetryAt, unique user/date/kind)를 추가한다.
- Netlify 크론이 DB에서 발송 대상을 선점하고 전송 직전에 활성 계정·숙소 권한·취소/완료/재배정을 재확인한다. 다중 기기는 기기별 발송 기록을 둔다.
- Service Worker push/notificationclick, VAPID 공개/비밀키, 만료 구독(404/410) 정리, 일시 오류 재시도 및 중복 방지를 구현한다. 로그아웃·계정 전환 시 기기 구독 연결을 해제한다.
- 잠금 화면에는 숙소명과 건수만 표시하고 게스트 이름/채팅은 넣지 않는다. 푸시 수락은 실제 열람 완료와 구분한다.
- 1차 아침 요약 → 2차 취소·재배정·체크아웃 확인 이벤트 → 3차 미확인 재알림(사용자 선택) 순서로 진행한다.
- OS의 절전·집중모드·네트워크에 따라 지연될 수 있다. 알람시계처럼 정시 소리를 보장하지 않는다. 기존 알림톡은 병행한다.

검증: iPhone 홈 화면 앱/Android에서 앱 닫힘, 거부/재허용, 로그아웃, 재배정, 중복 크론, 취소 일정, 실패 재시도.
공식 근거: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
