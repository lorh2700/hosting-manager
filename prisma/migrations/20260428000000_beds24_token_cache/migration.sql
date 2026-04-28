-- Persist Beds24 access token across serverless cold starts to avoid
-- hitting the /authentication/token rate limit (HTTP 429).
CREATE TABLE "beds24_token_cache" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beds24_token_cache_pkey" PRIMARY KEY ("id")
);
