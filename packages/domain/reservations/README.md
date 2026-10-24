# Reservation and scoped guest services

These modules extend the standalone API. They do not change the legacy Next.js routes or require a generated Prisma model.

## Wiring

- Merge `reservationRoutes` and `reservationBodySchemas` from `packages/contracts/reservations.ts` into the HTTP registry.
- Local reads use `createReservationService(database, options)`.
- `update`, `invitation`, `updateGuestNote`, and `review` run inside the common command runner's transaction. Before replay, call `authorizeCommand(actor, routeId, targetId, body)`; it checks current scope without checking a stale expected version.
- External commands use `createReservationCommandService(options)` with a short transaction factory, current identity refresh callback, and `createBeds24ReservationGateway()`.
- `execute(actor, 'create' | 'cancel', key, body, targetId)` returns a durable command result. `read`, `list`, and `reconcile` expose its outcome. Pass URL search parameters to `list` to preserve cursor pagination.
- Invitation secret is the same `JWT_SECRET` used by the public `/guest/welcome/[token]` decoder. Guest origin is `NEXT_PUBLIC_APP_URL` (the existing guest website), not the separate administrator app origin.

Reservation references are `event:<sourceId>` or `booking:<sourceId>` with a source ID of at most 90 URL-safe characters. Encode the full reference when using it as a URL segment. Calendar source type and source ID map directly to these references. Inquiry rows are excluded from both list and direct access.

## Schema readiness

Apply `prisma/migrations/20261005150000_reservation_workflows/migration.sql` through the controlled deployment process. It creates `backend_reservation_commands`, `backend_guest_notes`, and `backend_reservation_annotations`. The migration enables RLS and removes client-role table privileges. Runtime uses the trusted server database role.

Readiness can check `to_regclass('backend_reservation_commands')`, `to_regclass('backend_guest_notes')`, and `to_regclass('backend_reservation_annotations')`. Do not enable mutation endpoints before all three exist and the command encryption secret has at least 32 bytes.

## External outcome rules

The command payload is encrypted with a purpose-separated AES-GCM key. A durable `sent` claim commits before the only permitted external POST. Beds24 reads must confirm the marker, room, dates, and final status before a local reservation is finalized. A timeout, missing record, or uncertain response stays `needs_review`; it never triggers a second POST. The pending queue prioritizes unresolved work and supports bounded pages. A local commit failure is recoverable through read-only reconciliation.

Explicitly rejected requests can be entered again after correcting conditions. A request still marked `needs_review` requires reconciliation or manual external investigation, not a fresh creation. The API does not infer that an absent remote record proves a failed creation.

Verified cancellation updates both local booking and same-property Beds24 event representations. Completed, manual, and partner cleaning records are preserved. Only a pending automatic cleaning for today or a future checkout is marked cancelled when no confirmed checkout remains on that property/date. Existing cleaners remain recorded.

## Customer boundaries

Guest identity records in the legacy database are global. New customer responses therefore derive names, contact details, counts, and history only from authorized property reservation snapshots. Internal guest notes are keyed by organization and guest; they never overwrite legacy global guest notes. Candidate linking also requires an existing visible reservation. New reservation indexing enters the review queue without making a cross-business identity match.

## Verification

`tests/backend-reservations.test.ts` uses PGlite fixtures only. It covers current scope, inquiries, external ambiguity, concurrent idempotency, local rollback/recovery, invitation decoder compatibility, payment cancellation protection, duplicate local representations, cleaning preservation, scoped customer data, client-role SQL privileges, and pending-work pagination.
