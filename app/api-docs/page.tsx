'use client';

import { useEffect } from 'react';

// 외부 파트너용 v1 API 문서 — Swagger UI 를 CDN 으로 로드해 /public/v1-api.openapi.yaml
// 을 렌더링한다. 접근은 public — 인증은 각 endpoint 자체에서.
// 스테이폴리오에 https://voidanchae.com/api-docs URL 한 줄만 전달하면 충분.

const SWAGGER_VERSION = '5.17.14';
const CSS_URL = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css`;
const JS_URL  = `https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js`;

interface SwaggerUIWindow {
  SwaggerUIBundle?: (config: Record<string, unknown>) => unknown;
}

export default function ApiDocsPage() {
  useEffect(() => {
    // CSS (head 에 한 번만)
    if (!document.querySelector('link[data-swagger-ui]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CSS_URL;
      link.setAttribute('data-swagger-ui', '');
      document.head.appendChild(link);
    }

    const init = () => {
      const w = window as unknown as SwaggerUIWindow;
      if (!w.SwaggerUIBundle) return;
      w.SwaggerUIBundle({
        url: '/v1-api.openapi.yaml',
        dom_id: '#swagger-ui',
        deepLinking: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: 'list',
        tryItOutEnabled: true,
        persistAuthorization: true,
      });
    };

    const w = window as unknown as SwaggerUIWindow;
    if (w.SwaggerUIBundle) {
      init();
    } else if (!document.querySelector('script[data-swagger-ui]')) {
      const script = document.createElement('script');
      script.src = JS_URL;
      script.async = true;
      script.setAttribute('data-swagger-ui', '');
      script.onload = init;
      document.body.appendChild(script);
    }
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-stone-200 px-6 py-4 bg-white">
        <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)] mb-1 font-medium">
          Partner API
        </p>
        <h1 className="text-lg font-semibold text-stone-900">voidanchae v1 API</h1>
        <p className="text-xs text-stone-500 mt-1">
          외부 파트너사 (스테이폴리오 등) 전용 API. <code className="bg-stone-100 px-1">Authorization: Bearer vd_live_...</code> 헤더 필요.
          {' · '}
          <a href="/v1-api.openapi.yaml" download className="text-[var(--brand)] hover:underline">
            OpenAPI YAML 다운로드
          </a>
        </p>
      </header>
      <div id="swagger-ui" />
    </div>
  );
}
