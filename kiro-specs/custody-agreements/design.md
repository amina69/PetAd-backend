# Design Document: Custody Agreements API

## Overview

The Custody Agreements feature implements a REST API endpoint for creating temporary pet custody agreements. This design integrates with the existing NestJS application architecture, leveraging Prisma ORM for data persistence, JWT authentication for security, and existing EventLog and Escrow services for audit trails and deposit management.

The implementation follows NestJS best practices with a layered architecture: Controller (HTTP layer) → Service (business logic) → Repository (data access via Prisma). The feature validates pet availability, custody date parameters, and manages optional refundable deposits through the escrow system.

## Architecture

### Component Structure

```
src/custody/
├── custody.module.ts          # Module definition with dependencies
├── custody.controller.ts      # HTTP endpoint handler
├── custody.service.ts         # Business logic and orchestration
└── dto/
    ├── create-custody.dto.ts  # Request validation schema
    └── custody-response.dto.ts # Response serialization
```

### Module Dependencies

The CustodyModule requires the following imports:
- **PrismaModule**: Database access for Pet, Custody, and Adoption queries
- **EventsModule**: Event logging for audit trails
- **EscrowModule**: Deposit management (when implemented)

### Integration Points

1. **Authentication**: Uses existing JwtAuthGuard to protect the endpoint and extract userId from JWT payload
2. **EventLog Service**: Records CUSTODY_STARTED events with entityType CUSTODY
3. **Escrow Service**: Creates escrow records for deposits (future integration point)
4. **Prisma Service**: Direct database access for Pet, Custody, and Adoption models

## Components and Interfaces

### CustodyController

**Responsibility**: Handle HTTP requests, validate input, apply authentication, return responses

**Endpoint**: `POST /custody`

**Authentication**: Requires JWT token via `@UseGuards(JwtAuthGuard)`

**Request Extraction**:
- Body: `CreateCustodyDto` validated by class-validator
- User: Extract from JWT payload via custom `@CurrentUser()` decorator

**Response Codes**:
- 201 Created: Custody agreement successfully created
- 400 Bad Request: Validation errors, pet unavailable, invalid dates
- 401 Unauthorized: Missing or invalid JWT token
- 404 Not Found: Pet does not exist

**Swagger Documentation**: Uses NestJS @ApiTags, @ApiOperation, @ApiResponse decorators

### CustodyService

**Responsibility**: Orchestrate custody creation, validate business rules, coordinate with dependencies

**Key Methods**:

```typescript
async createCustody(
  userId: string,
  dto: CreateCustodyDto
): Promise<CustodyWithPet>
```

**Validation Logic**:
1. Verify pet exists (throw NotFoundException if not)
2. Check pet is not adopted (status !== ADOPTED)
3. Check no active adoption exists (status not in REQUESTED, PENDING, APPROVED, ESCROW_FUNDED)
4. Check no active custody exists (status === ACTIVE)
5. Validate startDate >= current date
6. Validate durationDays between 1 and 90
7. Calculate endDate = startDate + durationDays

**Transaction Flow**:
1. Create Custody record with status PENDING
2. If depositAmount provided, create Escrow record (future)
3. Log CUSTODY_STARTED event
4. Return custody with pet details

### Data Transfer Objects

**CreateCustodyDto**:
```typescript
{
  petId: string;           // UUID, required
  startDate: Date;         // ISO 8601, required, >= today
  durationDays: number;    // Integer, required, 1-90
  depositAmount?: number;  // Decimal(12,2), optional
}
```

**Validation Rules**:
- petId: IsUUID()
- startDate: IsDateString(), custom validator for future date
- durationDays: IsInt(), Min(1), Max(90)
- depositAmount: IsOptional(), IsNumber(), Min(0)

**CustodyResponseDto**:
```typescript
{
  id: string;
  status: CustodyStatus;
  type: CustodyType;
  depositAmount: Decimal | null;
  startDate: Date;
  endDate: Date;
  petId: string;
  holderId: string;
  escrowId: string | null;
  createdAt: Date;
  updatedAt: Date;
  pet: {
    id: string;
    name: string;
    species: PetSpecies;
    breed: string | null;
    age: number | null;
    description: string | null;
    imageUrl: string | null;
  };
}
```

### Custom Decorator: @CurrentUser()

Since the JWT strategy returns `{ userId, email, role }`, we need a parameter decorator to extract the user object from the request:

```typescript
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

## Data Models

### Custody Model (Prisma)

The Custody model already exists in the schema with the following structure:

```prisma
model Custody {
  id            String        @id @default(uuid())
  status        CustodyStatus @default(ACTIVE)
  type          CustodyType
  depositAmount Decimal?      @db.Decimal(12, 2)
  startDate     DateTime      @map("start_date")
  endDate       DateTime?
  petId         String        @map("pet_id")
  pet           Pet           @relation(...)
  holderId      String        @map("holder_id")
  holder        User          @relation(...)
  escrowId      String?       @unique @map("escrow_id")
  escrow        Escrow?       @relation(...)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

**Field Mappings**:
- `holderId`: Set to authenticated userId from JWT
- `type`: Set to TEMPORARY for custody agreements
- `status`: Initially set to PENDING (not ACTIVE as per requirements)
- `endDate`: Calculated as startDate + durationDays
- `depositAmount`: Optional, stored as Decimal(12, 2)
- `escrowId`: Linked when escrow is created

### Related Models

**Pet Model**: Used to validate pet existence and availability
- Check `currentOwnerId` is not null (pet has owner)
- Query adoptions to check for active adoption status

**Adoption Model**: Used to validate no active adoption exists
- Query where petId matches and status in (REQUESTED, PENDING, APPROVED, ESCROW_FUNDED)

**Escrow Model**: Created when depositAmount is provided
- Status set to CREATED
- Amount matches depositAmount
- Linked via escrowId foreign key

**EventLog Model**: Records custody creation event
- entityType: CUSTODY
- entityId: custody.id
- eventType: CUSTODY_STARTED
- actorId: userId
- payload: { petId, startDate, endDate, depositAmount }


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies:
- Properties 1.1 and 8.1 both test successful custody creation - combined into Property 1
- Properties 1.2 and 3.4 both test endDate calculation - combined into Property 2
- Properties 1.3 and 8.3 both test response structure - combined into Property 3
- Properties 4.1, 4.2, and 4.3 all test escrow creation - combined into Property 8
- Properties 5.3 and 5.4 both test userId handling - combined into Property 10
- Properties 6.1 and 6.4 both test DTO validation - combined into Property 11
- Properties 8.2 and 8.4 are covered by Property 3 (complete response)

### Property 1: Valid custody creation

*For any* authenticated user and valid custody request (existing pet, future startDate, durationDays 1-90, no active adoption/custody), the service should create a Custody record with status PENDING and return HTTP 201 with complete custody details including pet information.

**Validates: Requirements 1.1, 1.3, 8.1, 8.2**

### Property 2: EndDate calculation invariant

*For any* custody record, the endDate should equal startDate plus durationDays, and endDate should be greater than startDate.

**Validates: Requirements 1.2, 3.4, 8.3**

### Property 3: Event logging on creation

*For any* successfully created custody agreement, an EventLog record should exist with entityType CUSTODY, eventType CUSTODY_STARTED, and entityId matching the custody id.

**Validates: Requirements 1.4**

### Property 4: Pet unavailability rejection - active adoption

*For any* pet with an active adoption (status in REQUESTED, PENDING, APPROVED, ESCROW_FUNDED), custody requests for that pet should be rejected with HTTP 400.

**Validates: Requirements 2.2**

### Property 5: Pet unavailability rejection - adopted status

*For any* pet with status ADOPTED, custody requests for that pet should be rejected with HTTP 400.

**Validates: Requirements 2.3**

### Property 6: Pet unavailability rejection - active custody

*For any* pet with an active custody (status ACTIVE), custody requests for that pet should be rejected with HTTP 400.

**Validates: Requirements 2.4**

### Property 7: Deposit precision preservation

*For any* custody request with depositAmount, the stored value should maintain decimal precision (12, 2) and match the input value exactly.

**Validates: Requirements 4.4**

### Property 8: Escrow creation with deposit

*For any* custody request including depositAmount, an Escrow record should be created with status CREATED, amount matching depositAmount, and the custody should be linked via escrowId.

**Validates: Requirements 4.1, 4.2, 4.3, 8.4**

### Property 9: Custody without deposit

*For any* custody request without depositAmount, no Escrow record should be created and escrowId should be null.

**Validates: Requirements 4.1, 4.3**

### Property 10: HolderId matches authenticated user

*For any* custody created by an authenticated user, the holderId field should equal the userId extracted from the JWT token.

**Validates: Requirements 5.3, 5.4**

### Property 11: Required field validation

*For any* request missing petId, startDate, or durationDays, the API should reject the request with HTTP 400 and validation errors.

**Validates: Requirements 6.1, 6.4**

### Property 12: Type validation

*For any* request with invalid field types (non-UUID petId, non-date startDate, non-integer durationDays), the API should reject the request with HTTP 400 and validation errors.

**Validates: Requirements 6.1, 6.3**

## Error Handling

### Error Categories

**1. Not Found Errors (404)**
- Pet does not exist
- Response: `{ statusCode: 404, message: 'Pet not found', error: 'Not Found' }`

**2. Bad Request Errors (400)**
- Pet is adopted
- Pet has active adoption
- Pet has active custody
- startDate is in the past
- durationDays < 1 or > 90
- Missing required fields
- Invalid field types
- Response: `{ statusCode: 400, message: string | string[], error: 'Bad Request' }`

**3. Unauthorized Errors (401)**
- Missing JWT token
- Invalid JWT token
- Expired JWT token
- Response: `{ statusCode: 401, message: 'Unauthorized' }`

### Error Handling Strategy

**Controller Level**:
- NestJS ValidationPipe handles DTO validation automatically
- JwtAuthGuard handles authentication errors
- Service exceptions bubble up and are caught by NestJS exception filters

**Service Level**:
- Throw `NotFoundException` for non-existent pets
- Throw `BadRequestException` for business rule violations
- Include descriptive error messages for client debugging

**Transaction Safety**:
- Use Prisma transactions when creating custody + escrow together
- Rollback on any failure to maintain data consistency
- EventLog creation happens after successful custody creation

**Example Service Error Handling**:
```typescript
// Pet not found
if (!pet) {
  throw new NotFoundException(`Pet with id ${petId} not found`);
}

// Pet is adopted
if (pet.currentOwnerId && adoptions.some(a => a.status === 'ADOPTED')) {
  throw new BadRequestException('Pet is already adopted');
}

// Active custody exists
if (activeCustody) {
  throw new BadRequestException('Pet already has an active custody agreement');
}

// Date validation
if (startDate < new Date()) {
  throw new BadRequestException('Start date cannot be in the past');
}
```

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests**: Focus on specific examples, edge cases, and integration points
**Property Tests**: Verify universal properties across randomized inputs

### Unit Testing

**CustodyController Tests** (`custody.controller.spec.ts`):
- Successful custody creation with valid input
- Authentication guard is applied
- DTO validation rejects invalid input
- Service exceptions are properly propagated
- Response structure matches CustodyResponseDto

**CustodyService Tests** (`custody.service.spec.ts`):
- Pet not found throws NotFoundException
- Adopted pet throws BadRequestException
- Active adoption blocks custody creation
- Active custody blocks new custody creation
- Past startDate throws BadRequestException
- durationDays boundary cases (0, 1, 90, 91)
- endDate calculation is correct
- EventLog service is called with correct parameters
- Escrow service is called when deposit provided
- Escrow service not called when no deposit
- Transaction rollback on escrow creation failure

**Integration Tests** (`custody.e2e-spec.ts`):
- Full request/response cycle with real database
- JWT authentication flow
- Multiple custody creations for different pets
- Concurrent custody requests for same pet

### Property-Based Testing

**Library**: Use `fast-check` for TypeScript property-based testing

**Configuration**: Minimum 100 iterations per property test

**Test Tagging**: Each test must reference its design property:
```typescript
// Feature: custody-agreements, Property 1: Valid custody creation
```

**Property Test Suite** (`custody.properties.spec.ts`):

**Property 1: Valid custody creation**
- Generate: random userId, valid petId, future startDate, durationDays (1-90)
- Setup: Create pet with no adoptions/custodies
- Execute: Call createCustody
- Assert: Custody created with status PENDING, HTTP 201, complete response

**Property 2: EndDate calculation invariant**
- Generate: random startDate, durationDays (1-90)
- Execute: Create custody
- Assert: endDate === startDate + durationDays, endDate > startDate

**Property 3: Event logging on creation**
- Generate: random valid custody request
- Execute: Create custody
- Assert: EventLog exists with correct entityType, eventType, entityId

**Property 4-6: Pet unavailability rejection**
- Generate: random pet with active adoption/custody/adopted status
- Execute: Attempt custody creation
- Assert: Rejected with HTTP 400

**Property 7: Deposit precision preservation**
- Generate: random depositAmount with 2 decimal places
- Execute: Create custody with deposit
- Assert: Stored value matches input exactly

**Property 8: Escrow creation with deposit**
- Generate: random custody request with depositAmount
- Execute: Create custody
- Assert: Escrow created with status CREATED, amount matches, custody linked

**Property 9: Custody without deposit**
- Generate: random custody request without depositAmount
- Execute: Create custody
- Assert: No escrow created, escrowId is null

**Property 10: HolderId matches authenticated user**
- Generate: random userId from JWT
- Execute: Create custody
- Assert: custody.holderId === userId

**Property 11-12: Validation properties**
- Generate: random invalid requests (missing fields, wrong types)
- Execute: Attempt custody creation
- Assert: Rejected with HTTP 400, validation errors present

### Test Data Generators

**fast-check Arbitraries**:
```typescript
// Valid pet ID (UUID)
const petIdArb = fc.uuid();

// Future date (1-365 days from now)
const futureDateArb = fc.integer({ min: 1, max: 365 })
  .map(days => addDays(new Date(), days));

// Valid duration (1-90 days)
const durationArb = fc.integer({ min: 1, max: 90 });

// Valid deposit amount (0.01 to 10000.00)
const depositArb = fc.double({ min: 0.01, max: 10000, noNaN: true })
  .map(n => Math.round(n * 100) / 100);

// User ID (UUID)
const userIdArb = fc.uuid();
```

### Testing Balance

- Unit tests handle specific examples and edge cases (past dates, boundary values, missing fields)
- Property tests handle comprehensive input coverage through randomization
- Integration tests verify end-to-end behavior with real dependencies
- Together, they provide confidence in correctness across all scenarios

### Mock Strategy

**Unit Tests**: Mock PrismaService, EventsService, EscrowService
**Property Tests**: Use in-memory database or test database with cleanup
**Integration Tests**: Use test database with transaction rollback

