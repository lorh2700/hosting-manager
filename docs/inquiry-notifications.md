# Beds24 문의 자동답변과 카카오톡 이관

## 사용 흐름

1. 관리자 → 숙소 → 숙소 설정 → **고객 문의 알림**에서 담당자 이름과 휴대폰 번호를 저장하고 수신을 켠다.
2. 같은 화면의 **GPT 자동답변**에 실제 숙소 안내문을 작성한다. 체크인/체크아웃 시간, 위치, 주차, 시설 이용 등의 확정된 정보만 넣는다.
3. 필요한 연결 설정이 완료되면 자동답변을 켠다. 활성화 이후 도착한 문의부터 처리하며 이전 문의에는 소급 답변하지 않는다.
4. 답변하기 어려운 문의는 카카오톡으로 한국어 요약·이관 사유·상담 링크를 전달하고 해당 대화를 담당자 응대 상태로 전환한다.
5. 관리자 → 메시지에서 이관 사유, 초안, 카카오톡 접수 결과를 확인한다. 초안은 입력창으로 가져와 수정하고 직접 발송할 수 있다.
6. **직접 응대 시작** 버튼 또는 홈페이지의 직접 메시지 발송은 자동답변을 중지한다. **직접 응대 종료 · 자동답변 재개**를 눌러야 재개하며 그 이후의 새 문의부터 처리한다.

알림 수신을 끄면 해당 숙소의 자동답변도 함께 꺼진다. 수신자는 최대 10명이며 실제 알림 접수 직전에 현재 설정을 다시 조회한다.

## 배포 및 연결

- DB: `20260915000000_inquiry_notification_settings`와 `20260915010000_inquiry_automation` 마이그레이션을 순서대로 적용한다 (`prisma migrate deploy`). 별도 연락처/작업 테이블에는 RLS를 켜고 서버 API만 접근한다.
- 앱: `prisma generate` 후 빌드·배포. 기존 메시지 background function이 처리 큐를 실행하므로 함께 배포한다.
- 환경변수: `OPENAI_API_KEY`, `BEDS24_REFRESH_TOKEN`, `CRON_SECRET`, 기존 `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_PFID`, `SOLAPI_FROM` 및 새 `SOLAPI_TPL_INQUIRY_ESCALATED`.
- 선택: `INQUIRY_AI_MODEL` (기본 `gpt-4.1-mini`), `NEXT_PUBLIC_APP_URL` (기본 `https://voidanchae.com`). API 키는 서버에서만 사용한다.
- Beds24에서 플랫폼별 메시징 연결이 활성화되어 있어야 한다. 성공 응답은 Beds24의 **접수 확인**이며 고객 플랫폼 최종 도달 확인과 다르다.
- 최초 운영 전 테스트 예약으로 수신, 플랫폼 도달, 담당자 카카오톡 수신, 직접 응대 중지를 확인한다.

이 구현 작업에서는 운영 DB 변경·배포·고객 발송·실제 카카오톡 발송을 실행하지 않았다.

## 알림톡 템플릿 등록 초안

템플릿명 제안: `고객 문의 담당자 확인`

```text
[void anchae] 고객 문의 확인 요청

#{수신자명}님, 담당하시는 숙소에 확인이 필요한 고객 문의가 접수되었습니다.

숙소: #{숙소명}
게스트: #{게스트명}
문의 요약: #{문의요약}
확인 사유: #{확인사유}

아래 링크에서 대화를 확인하고 답변해 주세요.
#{상담링크}
```

승인된 템플릿 ID를 `SOLAPI_TPL_INQUIRY_ESCALATED`에 설정한다. 코드와 템플릿의 변수 이름을 정확히 맞춰야 한다.
카카오톡만 접수하며 SMS 자동 대체는 끈다. `accepted`는 SOLAPI 접수 성공이며 단말 최종 수신 보장은 아니다.

## 처리 및 오류 복구

- 기존 15분 메시지 수집 크론 이후 영속 큐를 보충한다. DB 메시지 ID를 큐의 기본 키로 사용하여 반복 동기화에도 중복 작업을 만들지 않는다.
- 단계: `queued → verify → booking → ready → checked → sending → sent`.
- GPT가 안내문/해당 예약에서 인용 근거를 제시한 답변만 독립 검토로 보낸다. 검토 후 실제 Beds24 예약의 숙소·예약번호·기간·인원·상태와 최신 대화를 다시 확인한다.
- 분류/검토 실패, 근거 부족, 환불·불만·예외·긴 문의, 외부 플랫폼 대화 변경은 `escalated`로 전환한다. 날짜나 출처를 확인할 수 없는 메시지는 자동답변 대상에서 제외한다.
- 임의의 예약 메모, 기존 대화의 주장, 도어락 정보는 권위 있는 안내 자료로 사용하지 않는다. 모델에 보낸 데이터는 프롬프트 지시로 취급하지 않도록 분리한다. 모델 판단 자체가 무오류인 것은 아니다.
- 한 번에 한 단계씩 처리한다. 작업 lease는 2분이며 자동 발송과 홈페이지 수동 발송은 동일 대화의 발송 잠금을 공유한다. 전송 중 상태 변경 요청에는 잠시 후 재시도하도록 안내한다.
- 외부 API 호출 전에 전송 의도와 로컬 메시지를 저장한다. 응답 불명·중단은 자동 재전송하지 않고 담당자 확인으로 넘긴다. 플랫폼 앱에서 확인 직후 사람이 보내는 경우까지 원자적으로 막을 API는 없으므로, 운영팀은 홈페이지의 직접 응대 시작 기능을 사용한다.
- 새 고객 문의가 담당자 응대 중 들어와도 자동답변은 하지 않고 요약·초안과 카카오톡 알림만 만든다.
- 알림은 문의/번호별 고유 작업을 사용한다. 확실한 접수 실패는 최소 5분 후 다음 크론에서 최대 3번 시도한다. 불명확한 결과(`unknown`)는 중복 방지를 위해 자동 재시도하지 않는다. 관리 화면에서 결과를 보고 SOLAPI 내역을 확인한다.
- 수신 이력 복구 범위는 최근 3일, 숙소당 한 번에 100건, background 한 번에 최대 80회/10분이다. 남은 작업은 다음 크론에서 이어서 처리한다.
- 로컬 예약과 연결되지 않은 플랫폼 문의는 기존 수집기가 저장하지 않으므로 이 자동화 대상에 포함되지 않는다.

## 검증

```powershell
node --experimental-strip-types --no-warnings --import ./tests/register.mjs --test tests/inquiry-worker.test.ts tests/inquiry-api.test.ts tests/inquiry-providers.test.ts tests/inquiry-background.test.ts tests/inquiry-notifications.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false --allowImportingTsExtensions
```

API/DB 대역으로 중복 실행, 이관, 권한, 수신자 변경, pause/resume, 중단 복구, 전송 접수 판정과 GPT 응답 검증을 테스트한다. 타입 검사 옵션은 기존 테스트 파일의 `.ts` 확장자 import를 허용한다. 실서비스 발송·실제 DB 트랜잭션·브라우저 렌더링 검증은 별도다.

## 확인한 공식 문서

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Beds24 API 명세](https://beds24.com/api/v2/apiV2.yaml)
- [SOLAPI 메시지 발송](https://solapi.com/developers/api/messages)
