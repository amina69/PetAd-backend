# Pet Status Lifecycle

`Pet.status` is the persisted availability snapshot. The lifecycle policy is
defined once in `src/pets/services/pet-status-transition.ts`; workflow writes
use `PetAvailabilityService.transition`, and `petAvailabilityReducer` uses the
same policy when replaying events.

## Statuses

| Status | Meaning |
| --- | --- |
| `AVAILABLE` | Available for adoption or temporary custody |
| `PENDING` | An adoption request is active |
| `IN_CUSTODY` | A temporary custody agreement is active |
| `ADOPTED` | Adoption is complete |

## Allowed Transitions

| From | To | Trigger |
| --- | --- | --- |
| `AVAILABLE` | `PENDING` | Adoption requested |
| `AVAILABLE` | `IN_CUSTODY` | Custody started |
| `PENDING` | `AVAILABLE` | Adoption rejected or cancelled |
| `PENDING` | `ADOPTED` | Adoption completed |
| `IN_CUSTODY` | `AVAILABLE` | Custody returned, cancelled, or violated |
| `ADOPTED` | `AVAILABLE` | Explicit lifecycle reset |

All other pairs, including same-status transitions, are rejected with HTTP 422
and the machine-readable code `PET_INVALID_TRANSITION`. The error includes the
current status, requested status, and allowed next states.

## Persistence and Workflows

`Pet.status` is a Prisma enum with a default of `AVAILABLE` and an index. The
migration `prisma/migrations/20261022150000_enforce_pet_status_lifecycle` adds
the field and backfills existing pets from completed adoptions, active
custodies, and active adoption requests, in that priority order.

Adoption requests, rejections, cancellations, and completions update the pet
status through `PetAvailabilityService`. Custody creation, return, cancellation,
and violation use the same service inside their database transaction. Escrow
release applies the `ADOPTED` transition in the transaction that completes the
adoption. Adoption and custody records retain their own state machines for
their domain-specific statuses.

## Event Replay and Verification

The pet availability reducer recognizes events from the pet, adoption, and
custody aggregates. Adoption approval leaves the pet `PENDING`; rejection and
cancellation return it to `AVAILABLE`. Invalid event histories fail through
the same transition policy instead of silently producing an impossible state.

`GET /pets/:id/availability/verify` is admin-only. It returns `storedStatus`,
`replayedStatus`, and `computedStatus` (derived from adoption/custody records).
`isMatch` is true only when all three agree. A manually edited `Pet.status`
therefore appears as drift rather than being overwritten by verification.

## Verification

```bash
npx prisma validate
npm test -- --runInBand --runTestsByPath src/pets/services/pet-status-transition.spec.ts src/events/reducers/pet-availability.reducer.spec.ts
npm run test:e2e -- --runInBand --runTestsByPath test/e2e/pets.e2e-spec.ts
```

The transition unit test enumerates all 16 state pairs. The pets E2E suite
manually changes a stored status and verifies that the endpoint reports the
mismatch.