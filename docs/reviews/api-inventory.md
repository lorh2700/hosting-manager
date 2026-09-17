# API 구현 목록

소스에서 직접 export된 HTTP 핸들러 목록이다. 존재 여부만 나타내며 권한·업무 규칙·UI 연결의 완성을 보증하지 않는다.

페이지 52개, API route 파일 107개, 직접 export된 핸들러 180개.

| 경로 | 메서드 |
|---|---|
| `/api/admin/api-clients/[id]` | DELETE |
| `/api/admin/api-clients` | GET, POST |
| `/api/admin/bookings` | GET |
| `/api/admin/calendar/events/[id]` | PATCH |
| `/api/admin/calendar` | GET |
| `/api/admin/calendar/supply-todos` | GET |
| `/api/admin/notify-test` | POST |
| `/api/admin/payments` | GET, POST |
| `/api/auth/change-password` | POST |
| `/api/auth/login` | POST |
| `/api/auth/logout` | POST |
| `/api/auth/me` | GET |
| `/api/auth/register` | POST |
| `/api/beds24/bookings` | POST, PUT |
| `/api/beds24/maintenance` | POST, DELETE |
| `/api/beds24/messages` | GET, POST |
| `/api/beds24/messages/send` | POST |
| `/api/beds24/reservations` | POST, DELETE |
| `/api/beds24/sync-all` | POST |
| `/api/beds24/sync` | POST |
| `/api/bookings/cancel` | POST |
| `/api/bookings` | GET, POST, PUT, DELETE |
| `/api/camera/diagnostics` | GET |
| `/api/camera/snapshots` | GET |
| `/api/checkout/confirm` | POST |
| `/api/checkout/qr` | GET |
| `/api/cleaner/today` | GET |
| `/api/cleaners/[id]/invite` | POST |
| `/api/cleaners/[id]/properties` | PUT |
| `/api/cleaners/[id]/reset-password` | POST |
| `/api/cleaners/me` | GET |
| `/api/cleaners` | GET, PUT, POST, DELETE |
| `/api/cleaning-applications/[id]/approve` | POST |
| `/api/cleaning-applications` | GET, POST, PUT |
| `/api/cleaning-issues` | GET, POST, PUT |
| `/api/cleanings` | GET, POST, PUT, DELETE |
| `/api/conversations/[id]/automation` | GET, PUT |
| `/api/conversations` | GET |
| `/api/cron/camera-inbox` | POST |
| `/api/cron/payments` | POST |
| `/api/dashboard` | GET |
| `/api/debug/me` | GET |
| `/api/events` | GET, POST, PUT, DELETE |
| `/api/export/[channelId]` | GET |
| `/api/guests/directory` | GET |
| `/api/guests/history` | GET, PUT, POST |
| `/api/guests` | GET, POST, PUT |
| `/api/health` | GET |
| `/api/holidays` | GET |
| `/api/inquiry-automation/process` | POST |
| `/api/integrations` | GET, POST, PUT, DELETE |
| `/api/invitations/[token]` | GET |
| `/api/invitations` | GET, POST |
| `/api/laundry` | GET, POST, PATCH |
| `/api/messages` | GET, POST, PUT |
| `/api/messages/unread-count` | GET |
| `/api/ops/today` | GET |
| `/api/properties/[id]/channels` | GET, POST, PUT, DELETE |
| `/api/properties/[id]/inquiry-automation` | GET, PUT |
| `/api/properties/[id]/inquiry-notifications` | GET, PUT |
| `/api/properties/[id]` | GET, PUT, DELETE |
| `/api/properties` | GET, POST |
| `/api/public/bookings` | POST |
| `/api/public/checkout/paypal/webhook` | POST |
| `/api/public/checkout` | POST |
| `/api/public/checkout/webhook` | POST |
| `/api/public/guest-checkout` | POST |
| `/api/public/properties/[id]` | GET |
| `/api/public/properties` | GET |
| `/api/public/stay-calendar` | GET |
| `/api/public/stay-search` | POST |
| `/api/public/tour-bookings` | POST |
| `/api/public/tours/[slug]` | GET |
| `/api/public/tours` | GET |
| `/api/public/welcomepad/active-event-override` | POST |
| `/api/public/welcomepad/checkins` | GET |
| `/api/public/welcomepad/checkout` | GET, POST |
| `/api/public/welcomepad/cleanings/done` | POST |
| `/api/setup` | POST |
| `/api/staff/cleaning-role` | POST |
| `/api/staff/link` | POST |
| `/api/staff/merge` | POST |
| `/api/staff` | GET, POST |
| `/api/supply-requests` | GET, POST, PUT |
| `/api/supply-todos` | GET, POST, PUT, DELETE |
| `/api/sync` | POST |
| `/api/tour-bookings/[id]/forward` | POST |
| `/api/tour-bookings` | GET, POST, PUT |
| `/api/tour-dashboard` | GET |
| `/api/tour-operators` | GET, POST, PUT, DELETE |
| `/api/tours/[id]/duration-options` | GET, POST, PUT, DELETE |
| `/api/tours/[id]` | GET |
| `/api/tours/[id]/schedule` | GET, POST, PUT, DELETE |
| `/api/tours/[id]/ticket-tiers` | GET, POST, PUT, DELETE |
| `/api/tours` | GET, POST, PUT, DELETE |
| `/api/uploads/tour-image` | POST |
| `/api/users/[id]` | DELETE |
| `/api/users` | POST, GET, PUT |
| `/api/v1/bookings/[id]` | GET |
| `/api/v1/bookings` | GET |
| `/api/v1/cleanings/[id]` | GET, PATCH, DELETE |
| `/api/v1/cleanings` | GET, POST |
| `/api/v1/properties/[id]/availability` | GET |
| `/api/v1/properties` | GET |
| `/api/welcomepad-chat/mark-read` | POST |
| `/api/welcomepad-chat/messages` | GET, POST |
| `/api/welcomepad-chat/threads` | GET |
