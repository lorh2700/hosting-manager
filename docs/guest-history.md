# Customer reservation history

- `GuestReservation` is the durable reservation ledger. Its `guestId` links to the existing `Guest` directory. Calendar deletion does not delete customer history.
- Canonical keys are `<propertyId>:beds24:<bookingId>` or `booking:<localId>` until an external reference exists. The latter is replaced when the Beds24 reference is assigned.
- Identity matching requires a unique candidate with the same normalized name plus email or international phone, without conflicting known contact details. Name-only matches and ambiguous identities require administrator review. Korean 010 numbers normalize to +82; other national formats are not guessed. Known relay/masked addresses are not matching identifiers.
- Administrator decisions are persisted with reviewer and time. New contact details trigger matching again. The review controls can split a reservation into a separate customer or exclude it from matching.
- Other confirmed/completed reservations indicate repeat booking. Cancelled, pending, unknown and no-show rows do not count. Past checkout dates alone are not proof of completed stays. No automatic completed-stay inference is implemented.
- Direct booking saves, payment confirmation/refund, Beds24 registration/cancellation and Beds24 sync index history. Customer-index failure does not turn a successful payment into a failed payment; it emits a non-PII retry log. Administrators can rerun local reconciliation.
- `/api/guests/history` and the customer directory require administrator access. Responses are private/no-store. The new ledger has RLS enabled and no anon/authenticated table grants.
- Admin > Guests contains review controls and a bounded existing-reservation reconciliation action. Reconciliation reads existing local reservations; it does not call booking creation or send guest messages.
- CLI backfill: `node --experimental-strip-types --no-warnings scripts/backfill-guest-history.mjs`. Uses the configured production DB, prints counts only, and is idempotent. Do not run against an unintended environment.
- Migration `20260913020000_guest_reservations` adds only columns, indexes and one table. In this workspace the migration SQL was applied and marked resolved separately because earlier migration records had pending entries. Do not blindly deploy those unrelated pending migrations.
- Customer retention/deletion policy, marketing consent and welcome-pad use of this new ledger are separate from this change. Existing welcome-pad matching is unchanged.

## Country and region

`guest_reservations.residence_country` stores the explicit Beds24 address country, using `country2` (two-letter selector) before recognized `country` text. Empty subsequent imports preserve existing residence data. Customer display selects the latest dated reservation with a recognized residence country; this takes precedence over telephone inference.

Telephone country/region is derived from the stored raw phone on read, separately labelled as an estimate. It is not stored as nationality or residence. No default country is assumed without an explicit + prefix. Shared calling codes remain ambiguous, even if an area code might narrow them further. International non-geographic numbers are labelled separately.

Run `node --experimental-strip-types --no-warnings scripts/backfill-guest-regions.mjs` to read existing Beds24 reservations and update matching local history with supplied country values only. It does not send messages or change external reservations.
