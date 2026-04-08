# void anchae

전통 한옥 숙박 관리 플랫폼. 다중 숙소 예약 관리, 채널 동기화, 청소 배정을 위한 어드민 대시보드입니다.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set your environment variables
3. Run the app:
   `npm run dev`

## Seed Data

숙소 데이터를 Firestore에 시딩하려면:

```bash
ADMIN_EMAIL=your@email.com ADMIN_PASSWORD=yourpass npm run seed
```
