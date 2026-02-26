# Implementation Plan: Custody Agreements API

## Overview

This implementation plan breaks down the Custody Agreements feature into incremental coding tasks. The feature adds a POST /custody endpoint to the NestJS application with comprehensive validation, escrow integration, and event logging. Each task builds on previous work, with property-based tests placed strategically to catch errors early.

## Tasks

- [x] 1. Set up module structure and DTOs
  - Create `src/custody/` directory structure
  - Implement `CreateCustodyDto` with class-validator decorators (petId, startDate, durationDays, depositAmount)
  - Implement `CustodyResponseDto` for response serialization
  - Create `@CurrentUser()` parameter decorator to extract user from JWT payload
  - _Requirements: 5.3, 5.4, 6.1, 6.4_

- [ ]* 1.1 Write property test for DTO validation
  - **Property 11: Required field validation**
  - **Property 12: Type validation**
  - **Validates: Requirements 6.1, 6.3, 6.4**

- [ ] 2. Implement CustodyService core logic
  - [x] 2.1 Create `CustodyService` with dependency injection (PrismaService, EventsService, EscrowService)
    - Implement `createCustody(userId: string, dto: CreateCustodyDto)` method
    - Add pet existence validation (throw NotFoundException if not found)
    - _Requirements: 1.1, 2.1_

  - [x] 2.2 Add pet eligibility validation
    - Check pet is not adopted (status !== ADOPTED)
    - Check no active adoption exists (query adoptions with status in REQUESTED, PENDING, APPROVED, ESCROW_FUNDED)
    - Check no active custody exists (status === ACTIVE)
    - Throw BadRequestException with descriptive messages for violations
    - _Requirements: 2.2, 2.3, 2.4_

  - [ ]* 2.3 Write property tests for pet eligibility
    - **Property 4: Pet unavailability rejection - active adoption**
    - **Property 5: Pet unavailability rejection - adopted status**
    - **Property 6: Pet unavailability rejection - active custody**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [x] 2.4 Add date validation and calculation
    - Validate startDate >= current date (throw BadRequestException if past)
    - Validate durationDays between 1 and 90 (throw BadRequestException if out of range)
    - Calculate endDate = startDate + durationDays
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.5 Write property test for date calculation
    - **Property 2: EndDate calculation invariant**
    - **Validates: Requirements 1.2, 3.4**

- [ ] 3. Implement custody creation with transaction
  - [x] 3.1 Create custody record with Prisma transaction
    - Set status to PENDING, type to TEMPORARY
    - Set holderId to userId from JWT
    - Store depositAmount if provided
    - Calculate and store endDate
    - Return custody with pet details (include pet relation)
    - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2, 8.3_

  - [ ]* 3.2 Write property test for valid custody creation
    - **Property 1: Valid custody creation**
    - **Validates: Requirements 1.1, 1.3, 8.1, 8.2**

  - [ ]* 3.3 Write property test for holderId assignment
    - **Property 10: HolderId matches authenticated user**
    - **Validates: Requirements 5.3, 5.4**

- [ ] 4. Integrate escrow service for deposits
  - [x] 4.1 Add escrow creation logic in transaction
    - When depositAmount is provided, call EscrowService to create escrow with status CREATED
    - Link escrow to custody via escrowId
    - Ensure transaction rollback if escrow creation fails
    - When depositAmount is not provided, leave escrowId as null
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.2 Write property tests for escrow handling
    - **Property 7: Deposit precision preservation**
    - **Property 8: Escrow creation with deposit**
    - **Property 9: Custody without deposit**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [ ] 5. Add event logging
  - [x] 5.1 Integrate EventLog service
    - After successful custody creation, call EventsService.logEvent
    - Set entityType to CUSTODY, eventType to CUSTODY_STARTED
    - Set entityId to custody.id, actorId to userId
    - Include payload with petId, startDate, endDate, depositAmount
    - _Requirements: 1.4_

  - [ ]* 5.2 Write property test for event logging
    - **Property 3: Event logging on creation**
    - **Validates: Requirements 1.4**

- [x] 6. Implement CustodyController
  - Create `CustodyController` with @Controller('custody') decorator
  - Add POST endpoint with @Post() decorator
  - Apply @UseGuards(JwtAuthGuard) for authentication
  - Use @Body() for CreateCustodyDto validation
  - Use @CurrentUser() decorator to extract user from JWT
  - Call CustodyService.createCustody and return result with HTTP 201
  - Add Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse for 201, 400, 401, 404)
  - _Requirements: 1.3, 5.1, 5.2, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4_

- [x] 7. Create CustodyModule
  - Define `CustodyModule` with @Module decorator
  - Import PrismaModule, EventsModule, EscrowModule
  - Declare and export CustodyController and CustodyService
  - Register module in main AppModule imports
  - _Requirements: 1.1_

- [x] 8. Checkpoint - Run all tests and verify integration
  - Ensure all property-based tests pass with minimum 100 iterations
  - Ensure all unit tests pass
  - Verify custody creation works end-to-end with authentication
  - Verify error handling for all validation scenarios
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check library with minimum 100 iterations
- All property tests must include feature and property tags in comments
- Escrow integration assumes EscrowService exists; if not implemented, create stub
- Transaction ensures atomicity between custody and escrow creation
- Custom @CurrentUser() decorator simplifies controller code
