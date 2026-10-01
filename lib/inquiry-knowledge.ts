export const KNOWLEDGE_LIMIT = 16000;
export const KNOWLEDGE_FILE_LIMIT = 64 * 1024;

/** Only plain UTF-8 text is accepted; uploaded text is never executed. */
export function decodeKnowledgeFile(name: string, bytes: Uint8Array): string {
  if (!/\.(txt|md)$/i.test(name)) throw new Error('TXT 또는 Markdown(.md) 파일을 선택해 주세요.');
  if (bytes.byteLength > KNOWLEDGE_FILE_LIMIT) throw new Error('파일은 64KB 이하로 준비해 주세요.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('UTF-8 형식으로 저장한 파일을 선택해 주세요.'); }
  text = text.replace(/\r\n?/g, '\n').trim();
  if (!text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('내용이 있는 일반 텍스트 파일을 선택해 주세요.');
  if (text.length > KNOWLEDGE_LIMIT) throw new Error('안내문은 16,000자까지 입력할 수 있습니다.');
  return text;
}

export function mergeKnowledge(current: string, incoming: string, mode: 'append' | 'replace'): string {
  const value = mode === 'replace' ? incoming.trim() : [current.trim(), incoming.trim()].filter(Boolean).join('\n\n');
  if (value.length > KNOWLEDGE_LIMIT) throw new Error('기존 내용과 합치면 16,000자를 초과합니다. 내용을 줄이거나 교체를 선택해 주세요.');
  return value;
}

export const KNOWLEDGE_TEMPLATE = `# 숙소 자동응답 안내문
숙소명:
최종 확인일:

## 체크인·체크아웃
정규 체크인 시간:
정규 체크아웃 시간:
얼리 체크인·늦은 체크아웃은 담당자 확인이 필요합니다.

## 위치·교통·주차
숙소 주소:
오시는 길:
주차 위치와 이용 조건:

## 짐 보관
보관 위치:
입실 전 보관 가능 시간:
퇴실 후 보관 가능 시간:
비용과 이용 조건:

## 시설·비품
구비된 물품:
시설 사용 방법:
이용 시 주의사항:

## 공항 이동
안내 가능한 서비스·공항·요금·조건:
실제 차량 예약·변경·취소는 담당자에게 전달합니다.

## 자주 묻는 질문
질문:
확정된 답변:

## 담당자 확인이 필요한 내용
환불·할인·보상, 예약 변경, 고장·불만, 분실물 확인, 개별 예외 요청.

작성 시 빈 항목은 삭제하고 확인된 정보만 남겨 주세요.
게스트 개인정보, 출입 비밀번호, 과거에 한 번 허용한 예외는 넣지 마세요.
`;
