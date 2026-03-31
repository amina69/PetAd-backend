# Custody Lifecycle State Machine

## Overview

The Custody State Machine enforces valid lifecycle transitions for custody records, preventing arbitrary status changes and ensuring data integrity for pet movement tracking.

## State Diagram

```
ACTIVE
  ├─→ RETURNED    (normal completion)
  ├─→ CANCELLED   (cancelled before completion)
  └─→ VIOLATION   (trust violation occurred)

Terminal States (immutable):
  • RETURNED
  • CANCELLED
  • VIOLATION
```

## Valid Transitions

| From Status | To Status | Description |
|------------|-----------|-------------|
| ACTIVE | RETURNED | Custody completed normally, pet returned |
| ACTIVE | CANCELLED | Custody cancelled before completion |
| ACTIVE | VIOLATION | Trust violation occurred during custody |

## Invalid Transitions

All transitions from terminal states are blocked:
- ❌ RETURNED → ACTIVE
- ❌ RETURNED → CANCELLED
- ❌ RETURNED → VIOLATION
- ❌ CANCELLED → ACTIVE
- ❌ CANCELLED → RETURNED
- ❌ CANCELLED → VIOLATION
- ❌ VIOLATION → ACTIVE
- ❌ VIOLATION → RETURNED
- ❌ VIOLATION → CANCELLED

## Implementation

### Core Components

1. **CustodyStatusTransitionValidator** (`src/custody/validators/custody-status-transition.validator.ts`)
   - Static validator class implementing state machine logic
   - Validates transitions before database updates
   - Provides transition information and utilities

2. **CustodyService** (`src/custody/custody.service.ts`)
   - Orchestrates custody status updates
   - Logs timeline events
   - Updates trust scores on violations
   - Integrates with EventsService

3. **CustodyController** (`src/custody/custody.controller.ts`)
   - REST API endpoints for custody management
   - Protected by JWT authentication
   - Exposes transition information

### API Endpoints

#### Get Custody
```
GET /custody/:id
```
Returns custody details with holder and pet information.

#### Update Custody Status
```
PATCH /custody/:id/status
Body: { "status": "RETURNED" | "CANCELLED" | "VIOLATION" }
```
Updates custody status with state machine validation.

#### Get Allowed Transitions
```
GET /custody/:id/transitions
```
Returns current status, allowed transitions, and terminal state flag.

### Validator Methods

#### `validate(currentStatus, newStatus)`
Validates if a transition is allowed. Throws `BadRequestException` if invalid.

```typescript
CustodyStatusTransitionValidator.validate(
  CustodyStatus.ACTIVE,
  CustodyStatus.RETURNED
); // ✓ Valid

CustodyStatusTransitionValidator.validate(
  CustodyStatus.RETURNED,
  CustodyStatus.ACTIVE
); // ✗ Throws BadRequestException
```

#### `isTerminalState(status)`
Checks if a status is terminal (immutable).

```typescript
CustodyStatusTransitionValidator.isTerminalState(CustodyStatus.RETURNED); // true
CustodyStatusTransitionValidator.isTerminalState(CustodyStatus.ACTIVE); // false
```

#### `getAllowedTransitions(currentStatus)`
Returns array of allowed target statuses.

```typescript
CustodyStatusTransitionValidator.getAllowedTransitions(CustodyStatus.ACTIVE);
// [CustodyStatus.RETURNED, CustodyStatus.CANCELLED, CustodyStatus.VIOLATION]

CustodyStatusTransitionValidator.getAllowedTransitions(CustodyStatus.RETURNED);
// []
```

#### `isTransitionValid(currentStatus, newStatus)`
Non-throwing validation check.

```typescript
CustodyStatusTransitionValidator.isTransitionValid(
  CustodyStatus.ACTIVE,
  CustodyStatus.RETURNED
); // true

CustodyStatusTransitionValidator.isTransitionValid(
  CustodyStatus.RETURNED,
  CustodyStatus.ACTIVE
); // false
```

#### `getTransitionInfo(currentStatus)`
Returns detailed transition information.

```typescript
CustodyStatusTransitionValidator.getTransitionInfo(CustodyStatus.ACTIVE);
// {
//   currentStatus: 'ACTIVE',
//   allowedTransitions: ['RETURNED', 'CANCELLED', 'VIOLATION'],
//   isTerminal: false,
//   description: 'Custody is currently active'
// }
```

## Side Effects

### Timeline Events
All status transitions are logged to the event log:
- Entity Type: `CUSTODY`
- Event Type: `CUSTODY_RETURNED` (or appropriate event)
- Payload includes previous status, new status, holder, and pet information

### Trust Score Updates
When custody status changes to `VIOLATION`:
- Holder's trust score is reduced by 10 points
- Trust score cannot go below 0
- A separate `TRUST_SCORE_UPDATED` event is logged

Example:
```typescript
// Before: trustScore = 50
await custodyService.updateStatus(custodyId, CustodyStatus.VIOLATION);
// After: trustScore = 40
```

### End Date
When transitioning to any terminal state, the `endDate` field is automatically set to the current timestamp.

## Testing

### Unit Tests

#### Validator Tests (`custody-status-transition.validator.spec.ts`)
- ✓ Valid transitions (ACTIVE → RETURNED, CANCELLED, VIOLATION)
- ✓ Terminal state immutability
- ✓ No-op transitions blocked
- ✓ Error messages
- ✓ Helper methods (isTerminalState, getAllowedTransitions, etc.)
- ✓ Edge cases

#### Service Tests (`custody.service.spec.ts`)
- ✓ Valid status updates
- ✓ Invalid transition blocking
- ✓ Event logging
- ✓ Trust score updates on violation
- ✓ Trust score floor (minimum 0)
- ✓ Error handling (not found, etc.)

#### Controller Tests (`custody.controller.spec.ts`)
- ✓ Endpoint functionality
- ✓ Authentication integration
- ✓ Request/response handling

### Running Tests

```bash
# Run all custody tests
npm test -- custody

# Run specific test file
npm test -- custody-status-transition.validator.spec.ts

# Run with coverage
npm test -- --coverage custody
```

## Error Handling

### BadRequestException
Thrown when:
- Attempting invalid transition
- Trying to modify terminal state
- No-op transition (same status)

Example error messages:
```
"Cannot change status from RETURNED. This is a terminal state and cannot be modified."
"Cannot change status from ACTIVE to ACTIVE. No transition needed."
"Cannot change status from RETURNED to CANCELLED. This transition is not allowed."
```

### NotFoundException
Thrown when:
- Custody ID does not exist

## Integration

### Module Dependencies
```typescript
@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
```

### Usage Example

```typescript
// In another service
constructor(private custodyService: CustodyService) {}

async completeCustody(custodyId: string, actorId: string) {
  // Check allowed transitions first (optional)
  const transitions = await this.custodyService.getAllowedTransitions(custodyId);
  
  if (transitions.allowedTransitions.includes(CustodyStatus.RETURNED)) {
    // Update status
    const custody = await this.custodyService.updateStatus(
      custodyId,
      CustodyStatus.RETURNED,
      actorId
    );
    
    return custody;
  }
}
```

## Acceptance Criteria

✅ **Invalid transitions blocked**
- All invalid transitions throw `BadRequestException`
- Terminal states are immutable

✅ **Terminal states immutable**
- RETURNED, CANCELLED, and VIOLATION cannot be changed
- `isTerminalState()` correctly identifies terminal states

✅ **Timeline events logged**
- Every status change creates an event log entry
- Events include actor, payload, and metadata

✅ **Trust score updated on VIOLATION**
- Trust score reduced by 10 points
- Minimum trust score is 0
- Trust score update event logged

✅ **Unit tests added**
- Validator: 100% coverage of transition logic
- Service: All methods tested with mocks
- Controller: Endpoint integration tested

## Future Enhancements

1. **Additional Event Types**
   - Add `CUSTODY_CANCELLED` and `CUSTODY_VIOLATION` event types to enum

2. **Configurable Trust Score Penalty**
   - Make violation penalty configurable via environment variable

3. **Notification System**
   - Send notifications on status changes
   - Alert admins on violations

4. **Audit Trail**
   - Enhanced logging with reason codes
   - Attach supporting documents to violations

5. **Automatic State Transitions**
   - Auto-complete custody after end date
   - Scheduled checks for overdue custodies
