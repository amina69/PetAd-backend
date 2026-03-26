# Requirements Document

## Introduction

The Custody Agreements feature enables users to request temporary custody of pets through a time-bound agreement system. Unlike permanent adoption, custody allows users to care for a pet for a specified period (e.g., 14 days) with an optional refundable deposit managed through an escrow system. This feature provides a flexible pet care solution while maintaining proper validation and tracking through the EventLog system.

## Glossary

- **Custody_API**: The REST API endpoint that handles custody agreement creation requests
- **Custody_Service**: The service layer component that orchestrates custody agreement creation and validation
- **Pet_Repository**: The data access component for retrieving and validating pet information
- **Custody_Repository**: The data access component for creating and querying custody records
- **Escrow_Service**: The service component that manages refundable deposit escrow accounts
- **EventLog_Service**: The service component that records system events for audit trails
- **Custody_Agreement**: A time-bound record representing temporary pet custody with start date, end date, and optional deposit
- **Active_Custody**: A custody record with status ACTIVE indicating ongoing temporary custody
- **Active_Adoption**: An adoption record with status in (REQUESTED, PENDING, APPROVED, ESCROW_FUNDED)
- **Available_Pet**: A pet that is not adopted and has no active custody
- **Deposit_Amount**: The refundable monetary amount held in escrow during custody period
- **Duration_Days**: The number of days for the custody period (minimum 1, maximum 90)
- **Authenticated_User**: A user with a valid JWT token containing userId

## Requirements

### Requirement 1: Create Custody Agreement

**User Story:** As an authenticated user, I want to request temporary custody of an available pet, so that I can care for the pet for a specific time period.

#### Acceptance Criteria

1. WHEN an Authenticated_User submits a custody request with valid petId, startDate, and Duration_Days, THE Custody_Service SHALL create a Custody_Agreement with status PENDING
2. THE Custody_Service SHALL calculate endDate as startDate plus Duration_Days
3. THE Custody_API SHALL return HTTP 201 Created with the created Custody_Agreement including pet details
4. WHEN a Custody_Agreement is created, THE EventLog_Service SHALL record an event with entityType CUSTODY and eventType CUSTODY_STARTED

### Requirement 2: Validate Pet Eligibility

**User Story:** As the system, I want to validate pet eligibility before creating custody agreements, so that pets are not double-booked or unavailable.

#### Acceptance Criteria

1. WHEN a custody request references a non-existent petId, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 404 Not Found
2. WHEN a custody request references a pet with an Active_Adoption, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request
3. WHEN a custody request references a pet with status ADOPTED, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request
4. WHEN a custody request references a pet with Active_Custody, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request

### Requirement 3: Validate Custody Date Parameters

**User Story:** As the system, I want to validate custody date parameters, so that custody agreements have valid time boundaries.

#### Acceptance Criteria

1. WHEN a custody request has startDate before the current date, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request
2. WHEN a custody request has Duration_Days less than 1, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request
3. WHEN a custody request has Duration_Days greater than 90, THE Custody_Service SHALL reject the request and THE Custody_API SHALL return HTTP 400 Bad Request
4. THE Custody_Service SHALL ensure endDate is greater than startDate

### Requirement 4: Handle Deposit and Escrow

**User Story:** As the system, I want to manage refundable deposits through escrow, so that deposits are securely held during the custody period.

#### Acceptance Criteria

1. WHERE a custody request includes Deposit_Amount, THE Custody_Service SHALL create an escrow record through Escrow_Service
2. WHEN an escrow is created for custody, THE Escrow_Service SHALL set escrow status to CREATED
3. WHERE a custody request includes Deposit_Amount, THE Custody_Service SHALL link the escrow to the Custody_Agreement
4. THE Custody_Service SHALL store Deposit_Amount as a Decimal type with precision (12, 2)

### Requirement 5: Authenticate Custody Requests

**User Story:** As the system, I want to authenticate custody requests, so that only authorized users can create custody agreements.

#### Acceptance Criteria

1. THE Custody_API SHALL require JWT authentication for all custody creation requests
2. WHEN an unauthenticated request is received, THE Custody_API SHALL return HTTP 401 Unauthorized
3. THE Custody_API SHALL extract userId from the validated JWT token
4. THE Custody_Service SHALL use the extracted userId as the holderId for the Custody_Agreement

### Requirement 6: Validate Request Data

**User Story:** As the system, I want to validate incoming custody request data, so that only well-formed requests are processed.

#### Acceptance Criteria

1. THE Custody_API SHALL validate the request body against CreateCustodyDto schema
2. WHEN required fields are missing from the request, THE Custody_API SHALL return HTTP 400 Bad Request with validation errors
3. WHEN field types are invalid in the request, THE Custody_API SHALL return HTTP 400 Bad Request with validation errors
4. THE CreateCustodyDto SHALL require petId, startDate, and Duration_Days as mandatory fields

### Requirement 7: Provide API Documentation

**User Story:** As a developer, I want comprehensive API documentation, so that I can integrate with the custody endpoint correctly.

#### Acceptance Criteria

1. THE Custody_API SHALL provide OpenAPI (Swagger) documentation for the POST /custody endpoint
2. THE Swagger documentation SHALL include request body schema with field descriptions
3. THE Swagger documentation SHALL include all possible response codes (201, 400, 401, 404)
4. THE Swagger documentation SHALL include example request and response payloads

### Requirement 8: Return Complete Custody Information

**User Story:** As a client application, I want complete custody information in the response, so that I can display custody details to users.

#### Acceptance Criteria

1. WHEN a Custody_Agreement is successfully created, THE Custody_API SHALL return the custody record with all fields
2. THE Custody_API response SHALL include the associated pet information
3. THE Custody_API response SHALL include the calculated endDate
4. WHERE an escrow was created, THE Custody_API response SHALL include the escrow reference
