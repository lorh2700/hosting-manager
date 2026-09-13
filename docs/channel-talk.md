# 채널톡

고객용 `(public)` 레이아웃에서 공식 `@channel.io/channel-web-sdk-loader`를 사용해 방문자 상담 위젯을 실행한다. 플러그인 키는 `components/ChannelTalk.tsx`에 지정되어 있으며 웹 설치용 공개 키다. Open API access key/secret은 필요하지 않다.

클라이언트 마운트 후 SDK를 비동기로 불러온다. 고객용 페이지 간 이동에는 재부팅하지 않고, 레이아웃을 벗어나면 shutdown한다. 관리자·직원 화면 및 결제 주문/승인 페이지에서는 부팅하지 않는다. 예약자 입력값이나 로그인 프로필은 SDK에 전달하지 않는다.

배포 후 실제 사이트에서 상담 버튼이 표시되는지 확인한다. 키의 채널 연결 유효성과 상담 수신은 운영 브라우저에서 확인해야 한다. 운영시간·인사말·담당자·버튼 모양은 채널톡 관리자에서 설정한다.

공식 설치 안내: https://developers.channel.io/en/articles/Quickstart-d27c51d1
