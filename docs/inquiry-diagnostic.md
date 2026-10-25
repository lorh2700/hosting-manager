# 발송 없는 AI 자동응답 테스트

관리자 웹의 `숙소 → 정비·응대 → AI 자동응답 → 발송 없이 테스트`에서 저장된 숙소 참고자료와 입력한 문의로 답변을 생성하고 검증한다. 참고자료 변경사항은 먼저 저장한다. 자동응답이 꺼져 있어도 테스트할 수 있다.

- 기존 `judgeInquiry`와 `verifyInquiry`, `OPENAI_API_KEY`, `INQUIRY_AI_MODEL`을 사용한다. 모델 기본값은 기존과 같은 `gpt-4.1-mini`다.
- 예약을 선택하지 않으므로 입퇴실 날짜·인원은 null이다. 예약별 정보와 Beds24 실제 전송 가능 여부는 검증하지 않는다.
- DB는 숙소 이름·자동응답 설정만 조회한다. 문의 작업 생성, 대화 중지·재개, Beds24 발송, 카카오톡 알림, 이력 저장을 하지 않는다.
- 생성과 검증은 각각 요청한다. 검증 오류가 나도 브라우저에는 먼저 생성한 초안이 남는다. 중간에 참고자료가 변경되면 재검사를 요구한다.
- 담당자 이관은 `review`, 기술적 실패는 `failed`다. 오류 원문·API 키 대신 허용된 오류 코드, HTTP 상태, 고정 안내문만 반환한다.

## 서버 연결 및 배포

1. 기존 `hosting-manager`에 `POST /api/internal/inquiry-diagnostic`와 middleware 변경을 배포한다. 해당 경로만 로그인 middleware를 통과하며, 핸들러는 32자 이상의 `BACKEND_BRIDGE_SECRET`을 검증한다.
2. `hosting-manager-platform/apps/api`를 배포한다. 기존 `NEXT_PUBLIC_APP_URL`의 origin을 자동응답 서버 주소로 사용한다. 이 서버와 기존 웹의 `BACKEND_BRIDGE_SECRET`이 같아야 한다. OpenAI 키를 API 서버나 브라우저에 복사하지 않는다.
3. `hosting-manager-platform/apps/web`를 배포한다. 인증된 BFF의 `POST /api/app/v1/properties/:id/messaging/test`를 사용하며 API에서 사업자·숙소 배정·메시지 메뉴 권한을 검사한다.

DB 마이그레이션이나 새 환경변수는 필요 없다. 실제 AI 호출에는 API 비용이 발생한다. 로컬 예시 서버는 AI를 호출하지 않고 명시적으로 표시한 예시 결과만 반환한다.

## 오류 확인

`connection`: 관리자 API에서 자동응답 서버까지 연결 실패. 404는 기존 웹 진단 경로의 미배포 가능성, 401/403은 연결 키 또는 접근 설정을 확인한다.

`context`: 숙소 또는 참고자료 조회 실패, 비어 있는 자료, 검증 도중 자료 변경.

`generation` / `verification`: OpenAI 인증·모델 권한·요청 제한·한도·연결·시간 초과·응답 형식 오류를 구분한다. 429 상태만으로 잔액 부족이라고 판단하지 않는다. 코드 의미는 [OpenAI 오류 문서](https://developers.openai.com/api/docs/guides/error-codes)를 따른다.

진단 통과는 실제 게스트 자동발송 성공을 뜻하지 않는다. 실제 파이프라인의 문의 대상 여부, 대화 중지, 예약 변경, 플랫폼 수신·발송은 별도 확인한다.
