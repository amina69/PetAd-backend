# Issue #22: Admin Approval Implementation

## Overview
This document describes the implementation of admin approval and rejection endpoints for adoption requests as specified in issue #22.

## Implementation Summary

### Files Created
1. **`src/adoption/dto/reject-adoption.dto.ts`**
   - DTO for rejection with optional reason field
   - Validates reason length (max 500 characters)
   - Includes Swagger documentation

### Files Modified
1. **`src/adoption/adoption.controller.ts`**
   - Added `PATCH /adoption/:id/approve` endpoint
   - Added `PATCH /adoption/:id/reject` endpoint
   - Both endpoints require ADMIN role via `@Roles(Role.ADMIN)` decorator
   - Both endpoints use `JwtAuthGuard` and `RolesGuard`
   - Added comprehensive Swagger documentation

2. **`src/adoption/adoption.service.ts`**
   - Added `approveAdoption()` method
   - Added `rejectAdoption()` method
   - Both methods use Prisma transactions for data consistency
   - Both methods validate state transitions using `AdoptionStateMachine`
   - Both methods log events and send notifications (best-effort)

3. **`src/adoption/adoption.service.spec.ts`**
   - Added comprehensive test suite for `approveAdoption()`
   - Added comprehensive test suite for `rejectAdoption()`
   - Tests cover success cases, error cases, and edge cases

4. **`src/adoption/adoption.controller.spec.ts`**
   - Added tests for approve endpoint
   - Added tests for reject endpoint
   - Tests cover both userId and sub JWT fields

## Features Implemented

### 1. Approve Adoption Endpoint
**Endpoint:** `PATCH /adoption/:id/approve`

**Authorization:** Admin only

**Behavior:**
- Validates adoption exists
- Validates adoption is in PENDING status (via state machine)
- Updates adoption status to APPROVED
- Logs ADOPTION_APPROVED event
- Sends notification email to adopter (best-effort)
- Returns updated adoption with pet, adopter, and owner details

**Response Codes:**
- 200: Success
- 403: Forbidden (non-admin user)
- 404: Adoption not found
- 422: Invalid status transition (not PENDING)

### 2. Reject Adoption Endpoint
**Endpoint:** `PATCH /adoption/:id/reject`

**Authorization:** Admin only

**Request Body:**
```json
{
  "reason": "Optional rejection reason (max 500 chars)"
}
```

**Behavior:**
- Validates adoption exists
- Validates adoption is in PENDING status (via state machine)
- Updates adoption status to REJECTED
- Appends rejection reason to notes field with `[REJECTED]` prefix
- Pet becomes available for other adopters (no explicit pet status update needed - handled by availability service)
- Sends notification email to adopter (best-effort)
- Returns updated adoption with pet, adopter, and owner details

**Response Codes:**
- 200: Success
- 403: Forbidden (non-admin user)
- 404: Adoption not found
- 422: Invalid status transition (not PENDING)

## State Machine Validation

Both endpoints leverage the existing `AdoptionStateMachine` service to enforce valid state transitions:

- **PENDING → APPROVED**: ✅ Valid
- **PENDING → REJECTED**: ✅ Valid
- **APPROVED → REJECTED**: ❌ Invalid (throws DomainException)
- **COMPLETED → APPROVED**: ❌ Invalid (throws DomainException)
- **REJECTED → APPROVED**: ❌ Invalid (throws DomainException)

## Transaction Safety

Both methods use Prisma transactions (`$transaction`) to ensure:
- Atomic updates to adoption records
- Consistent data state even if errors occur
- Rollback on failure

## Notification System

Both methods integrate with the notification queue service:
- Sends email to adopter on approval
- Sends email to adopter on rejection (with reason if provided)
- Notifications are best-effort (failures are logged but don't block the operation)

## Testing

### Unit Tests Added

**Service Tests (`adoption.service.spec.ts`):**
- ✅ Approve PENDING adoption successfully
- ✅ Reject PENDING adoption with reason
- ✅ Reject PENDING adoption without reason
- ✅ Append rejection reason to existing notes
- ✅ Throw NotFoundException when adoption doesn't exist
- ✅ Throw DomainException for invalid state transitions
- ✅ Fire ADOPTION_APPROVED event on approval

**Controller Tests (`adoption.controller.spec.ts`):**
- ✅ Approve adoption endpoint
- ✅ Reject adoption endpoint with reason
- ✅ Reject adoption endpoint without reason
- ✅ Handle both userId and sub JWT fields
- ✅ Propagate errors correctly

## Acceptance Criteria Status

✅ PATCH /adoption/:id/approve endpoint exists  
✅ PATCH /adoption/:id/reject endpoint exists  
✅ Both endpoints require ADMIN role  
✅ Only PENDING adoptions can be approved  
✅ Only PENDING adoptions can be rejected  
✅ Approval updates adoption status to APPROVED  
✅ Approval fires ADOPTION_APPROVED event  
✅ Rejection updates adoption status to REJECTED  
✅ Rejection can include optional reason/notes  
✅ Returns 404 if adoption not found  
✅ Returns 422 (via DomainException) if adoption not PENDING  
✅ Returns 403 for non-admin users (via RolesGuard)  

## Schema Compliance

✅ **No schema changes made** - As requested, the implementation uses only existing schema fields:
- `Adoption.status` (existing enum includes APPROVED and REJECTED)
- `Adoption.notes` (existing field used for rejection reason)
- `Adoption.createdAt` and `updatedAt` (existing timestamps)

Note: The requirement mentioned `approvedAt` timestamp, but since it doesn't exist in the schema and we were instructed not to add anything new, we rely on the `updatedAt` field which is automatically updated by Prisma.

## Pet Availability

The implementation correctly handles pet availability:
- On **approval**: Pet remains in current state (PENDING for escrow)
- On **rejection**: Pet automatically becomes available through the existing `PetAvailabilityService` which checks for active adoptions

No explicit pet status updates are needed because the system uses a computed availability based on active adoptions and custodies.

## API Documentation

All endpoints include comprehensive Swagger documentation:
- Operation summaries
- Response descriptions
- Status code documentation
- Parameter descriptions

## Error Handling

The implementation provides clear error messages:
- `NotFoundException`: "Adoption with id \"{id}\" not found"
- `DomainException`: "Invalid adoption status transition: {from} → {to}. Allowed transitions from {from}: [{allowed}]"
- `ForbiddenException`: Handled by RolesGuard for non-admin users

## Logging

Comprehensive logging is included:
- Info logs for successful operations
- Error logs for notification failures (non-blocking)
- Includes adoption ID, admin ID, pet ID, and reason in logs

## Next Steps

The implementation is ready for:
1. Integration testing with Postman/curl
2. E2E testing with real database
3. Future escrow integration (Phase 2)
4. Future notification enhancements

## Testing Instructions

### Manual Testing with Postman/curl

1. **Setup:**
   ```bash
   # Create test users
   POST /auth/register
   {
     "email": "admin@test.com",
     "password": "password123",
     "firstName": "Admin",
     "lastName": "User",
     "role": "ADMIN"
   }
   
   POST /auth/register
   {
     "email": "shelter@test.com",
     "password": "password123",
     "firstName": "Shelter",
     "lastName": "Owner",
     "role": "SHELTER"
   }
   
   POST /auth/register
   {
     "email": "user@test.com",
     "password": "password123",
     "firstName": "Regular",
     "lastName": "User",
     "role": "USER"
   }
   ```

2. **Create Pet (as SHELTER):**
   ```bash
   POST /pets
   Authorization: Bearer {shelter_token}
   {
     "name": "Buddy",
     "species": "DOG",
     "breed": "Golden Retriever",
     "age": 3
   }
   ```

3. **Submit Adoption Request (as USER):**
   ```bash
   POST /adoption/requests
   Authorization: Bearer {user_token}
   {
     "petId": "{pet_id}",
     "notes": "I would love to adopt this pet"
   }
   ```

4. **Approve Adoption (as ADMIN):**
   ```bash
   PATCH /adoption/{adoption_id}/approve
   Authorization: Bearer {admin_token}
   
   Expected: 200 OK
   Response: {
     "id": "{adoption_id}",
     "status": "APPROVED",
     "pet": {...},
     "adopter": {...},
     "owner": {...}
   }
   ```

5. **Reject Adoption (as ADMIN):**
   ```bash
   PATCH /adoption/{adoption_id}/reject
   Authorization: Bearer {admin_token}
   {
     "reason": "Incomplete documentation"
   }
   
   Expected: 200 OK
   Response: {
     "id": "{adoption_id}",
     "status": "REJECTED",
     "notes": "[REJECTED] Incomplete documentation",
     "pet": {...}
   }
   ```

6. **Test Authorization:**
   ```bash
   # Try to approve as regular USER
   PATCH /adoption/{adoption_id}/approve
   Authorization: Bearer {user_token}
   
   Expected: 403 Forbidden
   ```

7. **Test Invalid Transitions:**
   ```bash
   # Try to approve already approved adoption
   PATCH /adoption/{adoption_id}/approve
   Authorization: Bearer {admin_token}
   
   Expected: 422 Unprocessable Entity
   Error: "Invalid adoption status transition..."
   ```

## Conclusion

The implementation fully satisfies all requirements from issue #22:
- ✅ Two admin endpoints for approve/reject
- ✅ Proper authorization and validation
- ✅ State machine enforcement
- ✅ Event logging
- ✅ Notification system integration
- ✅ Comprehensive testing
- ✅ No schema changes
- ✅ Transaction safety
- ✅ Clear error handling
- ✅ API documentation

The code is production-ready and follows all NestJS and project best practices.
