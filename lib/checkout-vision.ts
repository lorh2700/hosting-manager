/**
 * 복도 카메라 스냅샷 → "짐을 들고 나가는 게스트인가" AI 판정.
 *
 *  - OpenAI GPT 비전 + 구조화 출력(JSON 스키마). 모델은 기본 gpt-4.1-mini, env CHECKOUT_VISION_MODEL 로 바꿀 수 있다.
 *  - 사람 식별은 하지 않는다: 존재/짐/방향/역할(게스트·직원)만 묻는다.
 *  - 사진은 1280px 폭으로 줄여 보낸다 (토큰 ≈ 비용). sharp 가 없으면 원본을 보낸다.
 *  - 판정 실패(거부·파싱 실패·네트워크)는 null 로 돌려주고, 호출자는 "판정 없음"으로 처리한다.
 */
import { z } from 'zod';
import type { CameraVerdict } from '@/lib/camera-types';

export const DEFAULT_VISION_MODEL = 'gpt-4.1-mini';

const VerdictSchema = z.object({
  people_present: z.boolean().describe('사진에 사람이 있는가'),
  person_count: z.number().describe('보이는 사람 수 (대략)'),
  luggage: z.enum(['none', 'small_bag', 'suitcase_or_large_bag', 'unclear']).describe('캐리어·큰 가방을 들었는가'),
  direction: z.enum(['toward_exit', 'toward_rooms', 'unclear']).describe('현관 쪽으로 나가는가, 객실 쪽으로 들어가는가'),
  likely_role: z.enum(['guest', 'staff', 'unclear']).describe('게스트인지, 청소용품·유니폼 등 직원 단서가 있는지'),
  confidence: z.number().describe('0~1 확신도'),
  summary_ko: z.string().describe('한 줄 한국어 요약. 예: 캐리어 2개를 끌고 현관 쪽으로 나가는 두 명'),
});

export interface JudgeInput {
  images: { buffer: ArrayBuffer; contentType: string; capturedAt: Date }[];
  propertyName: string;
  /** 숙소 설정의 카메라 위치 설명 (어느 쪽이 현관인지 등) */
  cameraNotes?: string | null;
}

// 이전 배포의 Claude 모델 환경변수가 남아 있어도 OpenAI 모델로 전환한다.
export function checkoutVisionModel(): string {
  const configured = process.env.CHECKOUT_VISION_MODEL?.trim();
  return !configured || configured.startsWith('claude-') ? DEFAULT_VISION_MODEL : configured;
}

const ResponseSchema = z.object({
  status: z.literal('completed'),
  model: z.string().min(1),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
});

async function downscale(buffer: ArrayBuffer, contentType: string): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' }> {
  try {
    const sharp = (await import('sharp')).default;
    const out = await sharp(Buffer.from(buffer)).rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { data: out.toString('base64'), mediaType: 'image/jpeg' };
  } catch {
    const mediaType = contentType === 'image/png' ? 'image/png' : 'image/jpeg';
    return { data: Buffer.from(buffer).toString('base64'), mediaType };
  }
}

function kstTime(d: Date): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
}

const SYSTEM = `당신은 한옥 스테이 복도 CCTV 스냅샷을 보고 "게스트가 짐을 들고 체크아웃(퇴실)하는 장면인지"만 판단하는 보조 시스템입니다.
규칙:
- 사람을 식별하거나 특징을 묘사하지 않습니다. 존재 여부, 대략의 인원, 짐(캐리어·큰 가방), 이동 방향, 게스트/직원 여부 단서만 봅니다.
- 캐리어나 큰 여행 가방을 끌거나 메고 현관 쪽으로 향하면 퇴실 가능성이 높습니다. 빈손이거나 작은 가방만 있으면 잠깐 외출일 수 있습니다.
- 청소용품, 세탁물 꾸러미, 유니폼, 카트가 보이면 직원(청소팀)일 수 있습니다.
- 흑백(적외선) 사진, 잘린 프레임, 사람이 겹친 사진은 확신도를 낮추고 unclear 를 쓰세요.
- 확신도(confidence)는 0~1 사이 숫자로, 근거가 약하면 0.5 아래로 두세요.
결과는 요청된 JSON 형식으로만 답합니다.`;

/**
 * 스냅샷 1~6장으로 한 번 판정. 실패하면 null.
 */
export async function judgeCheckoutSnapshot(input: JudgeInput): Promise<CameraVerdict | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || input.images.length === 0) return null;
  const model = checkoutVisionModel();

  try {

    const frames = await Promise.all(input.images.slice(0, 6).map(img => downscale(img.buffer, img.contentType)));
    const content: ({ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' })[] = [];
    frames.forEach((f, i) => {
      content.push({ type: 'input_text', text: `사진 ${i + 1} (${kstTime(input.images[i].capturedAt)} KST)` });
      content.push({ type: 'input_image', image_url: `data:${f.mediaType};base64,${f.data}`, detail: 'high' });
    });
    content.push({
      type: 'input_text',
      text:
        `숙소: ${input.propertyName}\n` +
        (input.cameraNotes ? `카메라 위치 설명: ${input.cameraNotes}\n` : '') +
        `위 사진들이 같은 감지 이벤트의 연속 장면입니다. 사람이 짐을 들고 현관 쪽으로 나가는 장면인지 판단해 JSON 으로 답하세요.`,
    });

    const { $schema: _schema, ...schema } = z.toJSONSchema(VerdictSchema);
    const result = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 1024,
        instructions: SYSTEM,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'checkout_verdict', strict: true, schema } },
      }),
    });
    if (!result.ok) {
      // API 응답 본문에는 요청 정보가 포함될 수 있으므로 상태 코드만 기록한다.
      console.warn('[checkout-vision] OpenAI API error', result.status);
      return null;
    }
    const parsed = ResponseSchema.safeParse(await result.json());
    if (!parsed.success) return null;
    const response = parsed.data;
    const blocks = response.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []);
    if (blocks.some(block => block.type === 'refusal')) return null;
    const output = blocks.filter(block => block.type === 'output_text').map(block => block.text ?? '').join('');
    const p = VerdictSchema.parse(JSON.parse(output));
    return {
      peoplePresent: p.people_present,
      personCount: Math.max(0, Math.round(p.person_count)),
      luggage: p.luggage,
      direction: p.direction,
      likelyRole: p.likely_role,
      confidence: Math.min(1, Math.max(0, p.confidence)),
      summary: p.summary_ko.trim().slice(0, 200),
      model: response.model,
      judgedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn('[checkout-vision] no verdict', err instanceof Error ? err.name : 'UnknownError');
    return null;
  }
}
