// `node --import ./tests/register.mjs --test` 로 실행된다.
// 1) TS 경로 별칭(@/…)과 인프라 스텁을 해결하는 로더 등록
// 2) 테스트 프로세스에 필요한 최소 환경변수
import { register } from 'node:module';

process.env.JWT_SECRET ??= 'test-secret';
process.env.BEDS24_REFRESH_TOKEN ??= 'test-refresh-token';
process.env.NODE_ENV ??= 'test';

register('./loader.mjs', import.meta.url);
