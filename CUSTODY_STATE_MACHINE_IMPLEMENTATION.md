# Custody Lifecycle State Machine Implementation

## Overview
This document describes the implementation of GitHub issue #60: **Implement Custody Lifecycle State Machine** for the PetAd backend.

## Files Created

### 1. **CustodyStateMachine Service**
- **Path**: `src/custody/services/custody-state-machine.service.ts`
- **Purpose**: Manages valid state transitions for custody agreements

**Key Methods:**
- `canTransition(from: CustodyStatus, to: CustodyStatus): boolean` - Checks if transition is valid
- `getValidTransitions(from: CustodyStatus): CustodyStatus[]` - Returns allowed transitions from a status
- `assertCanTransition(from: CustodyStatus, to: CustodyStatus): void` - Validates transition or throws DomainException (HTTP 422)
- `getTransitionsMap()` - Returns the complete transition map for introspection

**Transition Map:**
```
PENDING → [ACTIVE, CANCELLED]
ACTIVE → [RETURNED, CANCELLED, VIOLATION]
RETURNED → [] (terminal)
CANCELLED → [] (terminal)
VIOLATION → [] (terminal)
```

### 2. **CustodyStateMachine Tests**
- **Path**: `src/custody/services/custody-state-machine.service.spec.ts`
- **Coverage**:
  - ✅ All valid transitions pass `canTransition()`
  - ✅ All invalid transitions (e.g., RETURNED→ACTIVE, CANCELLED→PENDING) are blocked
  - ✅ Terminal states are immutable (empty transitions array)
  - ✅ `assertCanTransition()` throws DomainException with descriptive error messages
  - ✅ Error messages contain from/to statuses and allowed transitions
  - ✅ `getValidTransitions()` returns correct transitions for each status
  - ✅ `getTransitionsMap()` returns frozen transitions map

## Files Modified

### 1. **CustodyModule** (`src/custody/custody.module.ts`)
- Added `CustodyStateMachine` to providers and exports
- Service is now available for dependency injection

### 2. **CustodyService** (`src/custody/custody.service.ts`)

**Injection:**
- Injected `CustodyStateMachine` into constructor

**Updated Methods:**

#### `returnCustody(custodyId: string): Promise<CustodyResponseDto>`
- ✅ Enforces state machine validation via `assertCanTransition(ACTIVE, RETURNED)`
- ✅ Logs timeline event with enhanced payload:
  - `fromStatus`: Previous custody status
  - `toStatus`: RETURNED
  - `timestamp`: ISO timestamp of transition
- ✅ Updates custody holder's trust score (+5) on successful return
- ✅ Releases escrow if present

#### `violationCustody(custodyId: string): Promise<CustodyResponseDto>`
- ✅ Enforces state machine validation via `assertCanTransition(ACTIVE, VIOLATION)`
- ✅ Logs timeline event with enhanced payload:
  - `fromStatus`: Previous custody status
  - `toStatus`: VIOLATION
  - `timestamp`: ISO timestamp of transition
- ✅ Updates custody holder's trust score (-15) on violation (significant penalty)
- ✅ Refunds escrow if present

#### `cancelCustody(custodyId: string, reason?: string): Promise<CustodyResponseDto>` (NEW)
- ✅ Enforces state machine validation via `assertCanTransition(status, CANCELLED)`
- ✅ Logs timeline event with enhanced payload:
  - `fromStatus`: Previous custody status
  - `toStatus`: CANCELLED
  - `reason`: Optional cancellation reason
  - `timestamp`: ISO timestamp of transition
- ✅ Refunds escrow if present
- ✅ Allows cancellation from both PENDING and ACTIVE statuses

### 3. **CustodyService Tests** (`src/custody/custody.service.spec.ts`)

**New Test Suites:**

#### `returnCustody` Tests
- ✅ Throws NotFoundException when custody doesn't exist
- ✅ Throws DomainException when status is not ACTIVE
- ✅ Successfully returns custody when status is ACTIVE
- ✅ Updates trust score with +5 on successful return
- ✅ Logs timeline event with transition details (fromStatus, toStatus)

#### `violationCustody` Tests
- ✅ Throws NotFoundException when custody doesn't exist
- ✅ Throws DomainException when status is not ACTIVE
- ✅ Successfully marks custody as VIOLATION when status is ACTIVE
- ✅ Updates trust score with -15 penalty on violation
- ✅ Logs timeline event with transition details (fromStatus, toStatus)

## Implementation Details

### State Validation
All custody status updates now enforce the state machine validation:
- Throws `DomainException` (HTTP 422 Unprocessable Entity) with message format:
  ```
  Invalid custody status transition: {fromStatus} → {toStatus}. Allowed transitions from {fromStatus}: [{allowed1}, {allowed2}]
  ```

### Timeline Events
Enhanced event logging includes:
- `entityType`: 'CUSTODY'
- `entityId`: custody ID
- `eventType`: 'CUSTODY_RETURNED' | 'CUSTODY_VIOLATION' | 'CUSTODY_CANCELLED'
- `actorId`: custody holder ID
- `payload`:
  - `petId`: Associated pet ID
  - `holderId`: Custody holder ID
  - `fromStatus`: Previous custody status
  - `toStatus`: New custody status
  - `reason`: (optional) Reason for state change
  - `timestamp`: ISO timestamp of transition

### Trust Score Updates
- **RETURNED**: +5 (positive behavior - returned pet on time)
- **VIOLATION**: -15 (negative behavior - custody terms violated)
- Trust scores are clamped to [0, 100] range by `UsersService.updateTrustScore()`

## Error Handling
- `NotFoundException`: Custody record not found
- `DomainException` (HTTP 422): Invalid state transition (replaced old `BadRequestException`)
- All database operations use transactions to ensure consistency

## Testing Strategy
- **Unit Tests**: State machine logic (valid/invalid transitions, error messages)
- **Service Tests**: Custody service integration with state machine validation
- **Integration Points**: 
  - EventsService (timeline logging)
  - UsersService (trust score updates)
  - EscrowService (escrow operations)
  - PrismaService (database transactions)

## Patterns Followed
- Mirrors existing `AdoptionStateMachine` pattern for consistency
- Uses `DomainException` for domain-specific errors (HTTP 422)
- Follows NestJS dependency injection patterns
- Uses Prisma transactions for atomic operations
- Comprehensive error messages for debugging

## Usage Example

```typescript
// Validate transition
const canReturn = custodyStateMachine.canTransition(
  CustodyStatus.ACTIVE, 
  CustodyStatus.RETURNED
); // true

// Get allowed transitions
const allowed = custodyStateMachine.getValidTransitions(CustodyStatus.ACTIVE);
// ['RETURNED', 'CANCELLED', 'VIOLATION']

// Return custody (with validation)
await custodyService.returnCustody(custodyId);
// Throws DomainException if not ACTIVE

// Mark violation (with validation)
await custodyService.violationCustody(custodyId);
// Throws DomainException if not ACTIVE

// Cancel custody (with validation)
await custodyService.cancelCustody(custodyId, 'Pet returned early');
// Throws DomainException if transition invalid
```

## Summary
✅ Complete implementation of Custody Lifecycle State Machine with:
- Explicit transition map enforcing valid state changes
- Comprehensive validation before all status updates
- Timeline event logging for audit trail
- Trust score updates on key transitions
- Full test coverage for all transitions and error cases
- Consistent patterns with existing adoption state machine
