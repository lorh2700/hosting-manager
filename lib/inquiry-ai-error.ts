export class InquiryAiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  constructor(code: string, httpStatus?: number, providerCode?: string) {
    super(code);
    this.name = 'InquiryAiError';
    this.code = code; this.httpStatus = httpStatus; this.providerCode = providerCode;
  }
}

const providerCodes = new Set(['invalid_api_key', 'model_not_found', 'insufficient_quota', 'credit_balance_exhausted',
  'project_spend_limit_exceeded', 'organization_spend_limit_exceeded', 'organization_usage_limit_exceeded',
  'usage_limit_exceeded', 'rate_limit_exceeded', 'slow_down', 'server_is_overloaded']);

export function providerFailure(status: number, body: unknown) {
  const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
  const candidate = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const type = error && typeof error === 'object' && 'type' in error ? error.type : null;
  const code = typeof candidate === 'string' && providerCodes.has(candidate) ? candidate
    : type === 'insufficient_quota' ? 'insufficient_quota' : undefined;
  return new InquiryAiError(`AI_HTTP_${status}`, status, code);
}

export function inquiryFailure(error: unknown) {
  if (!(error instanceof InquiryAiError)) return { code: 'AI_UNEXPECTED', message: 'AI 처리 중 예상하지 못한 오류가 발생했습니다. 서버 로그를 확인해 주세요.' };
  const code = error.providerCode || error.code;
  let message = 'AI 응답을 처리하지 못했습니다. 오류 코드를 확인해 주세요.';
  if (error.code === 'AI_CONFIG_MISSING') message = '자동응답 서버에 OpenAI API 키가 설정되지 않았습니다.';
  else if (error.httpStatus === 401) message = 'OpenAI 인증에 실패했습니다. 자동응답 서버의 API 키와 접근 제한을 확인해 주세요.';
  else if (error.httpStatus === 403) message = 'OpenAI 접근이 거부되었습니다. 프로젝트·모델 사용 권한과 접근 제한을 확인해 주세요.';
  else if (code === 'model_not_found' || error.httpStatus === 404) message = '설정된 AI 모델을 찾을 수 없거나 사용할 권한이 없습니다.';
  else if (['insufficient_quota', 'credit_balance_exhausted', 'project_spend_limit_exceeded', 'organization_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'usage_limit_exceeded'].includes(code)) message = '이 API 키가 속한 프로젝트 또는 조직의 잔액·사용 한도에 도달했습니다. 해당 프로젝트의 결제 설정을 확인해 주세요.';
  else if (error.httpStatus === 429) message = 'OpenAI가 요청을 제한했습니다. 잠시 후 다시 시도해 주세요. 한도 오류인지 요청 속도 제한인지는 오류 코드를 확인해 주세요.';
  else if (error.httpStatus === 400) message = 'OpenAI가 요청 형식을 거부했습니다. 모델 설정과 응답 형식의 호환성을 확인해 주세요.';
  else if (error.httpStatus && error.httpStatus >= 500) message = 'OpenAI 서비스가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  else if (code === 'AI_TIMEOUT') message = 'AI 응답 대기 시간(15초)을 초과했습니다. 잠시 후 다시 시도해 주세요.';
  else if (code === 'AI_NETWORK') message = '자동응답 서버에서 OpenAI에 연결하지 못했습니다. 네트워크 연결을 확인해 주세요.';
  else if (code === 'AI_REFUSED') message = 'AI가 답변 생성을 거부했습니다. 문의 내용을 검토해 주세요.';
  else if (code === 'AI_INCOMPLETE') message = 'AI가 답변을 끝까지 생성하지 못했습니다. 문의를 짧게 나누거나 모델 설정을 확인해 주세요.';
  else if (code === 'AI_INVALID_RESPONSE') message = 'AI 응답이 필요한 JSON 형식과 일치하지 않습니다. 응답 형식 설정을 확인해 주세요.';
  return { code, message, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}) };
}

export function inquiryDatabaseFailure(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (['42P01', '42703', 'P2021', 'P2022'].includes(String(code))) return { code: 'DATABASE_SCHEMA_MISSING', message: '자동응답에 필요한 DB 테이블 또는 컬럼이 없습니다. DB 업데이트 상태를 확인해 주세요.' };
    if (['P1002', 'P2024', 'ETIMEDOUT', '57014'].includes(String(code)) || (current instanceof Error && /connection timeout|timed out|timeout exceeded/i.test(current.message))) {
      return { code: 'DATABASE_TIMEOUT', message: 'DB 연결 또는 조회 대기 시간을 초과했습니다. DB 연결 수와 응답 시간을 확인해 주세요.' };
    }
    if (['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED'].includes(String(code))) return { code: 'DATABASE_TLS_FAILED', message: 'DB 보안 연결의 인증서를 확인하지 못했습니다. 서버의 DB 인증서 설정을 확인해 주세요.' };
    current = 'cause' in current ? current.cause : null;
  }
  return { code: 'DATABASE_UNAVAILABLE', message: '숙소 안내 자료를 조회하지 못했습니다. 자동응답 서버의 DB 연결과 로그를 확인해 주세요.' };
}
