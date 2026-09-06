/**
 * 복도 카메라 스냅샷 → "짐을 들고 나가는 게스트인가" AI 판정.
 *
 *  - Claude 비전 + 구조화 출력(JSON 스키마). 모델은 기본 claude-opus-5, env CHECKOUT_VISION_MODEL 로 바꿀 수 있다.
 *  - 사람 식별은 하지 않는다: 존재/짐/방향/역할(게스트·직원)만 묻는다.
 *  - 사진은 1280px 폭으로 줄여 보낸다 (토큰 ≈ 비용). sharp 가 없으면 원본을 보낸다.
 *  - 판정 실패(거부·파싱 실패·네트워크)는 null 로 돌려주고, 호출자는 "판정 없음"으로 처리한다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { CameraVerdict } from '@/lib/camera-types';

export const DEFAULT_VISION_MODEL = 'claude-opus-5';

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

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (client ??= new Anthropic());
}

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
  const anthropic = getClient();
  if (!anthropic || input.images.length === 0) return null;
  const model = process.env.CHECKOUT_VISION_MODEL || DEFAULT_VISION_MODEL;

  const frames = await Promise.all(input.images.slice(0, 6).map(img => downscale(img.buffer, img.contentType)));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  frames.forEach((f, i) => {
    content.push({ type: 'text', text: `사진 ${i + 1} (${kstTime(input.images[i].capturedAt)} KST)` });
    content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.data } });
  });
  content.push({
    type: 'text',
    text:
      `숙소: ${input.propertyName}\n` +
      (input.cameraNotes ? `카메라 위치 설명: ${input.cameraNotes}\n` : '') +
      `위 사진들이 같은 감지 이벤트의 연속 장면입니다. 사람이 짐을 들고 현관 쪽으로 나가는 장면인지 판단해 JSON 으로 답하세요.`,
  });

  try {
    const response = await anthropic.beta.messages.parse({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: betaZodOutputFormat(VerdictSchema) },
      // 정책상 거부되면 다른 모델로 같은 요청을 이어가 판정이 비지 않게 한다.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      console.warn('[checkout-vision] no verdict', { stop: response.stop_reason });
      return null;
    }
    const p = response.parsed_output;
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
    if (err instanceof Anthropic.RateLimitError) console.warn('[checkout-vision] rate limited');
    else if (err instanceof Anthropic.APIError) console.error('[checkout-vision] api error', err.status, err.message);
    else console.error('[checkout-vision] error', err);
    return null;
  }
}
