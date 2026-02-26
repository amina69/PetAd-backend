# PR: Pet Status Lifecycle Implementation (Closes #17)

## Overview
This PR implements the Pet Status Lifecycle feature, enforcing a state machine for pet status transitions throughout the adoption and custody process. It ensures that pets can only move between valid states, maintaining data integrity and preventing invalid transitions.

## Features
- **State Machine for Pet Status:**
  - Enforces valid transitions: AVAILABLE → PENDING → ADOPTED, AVAILABLE → IN_CUSTODY → AVAILABLE, etc.
  - Blocks invalid transitions (e.g., ADOPTED → PENDING, IN_CUSTODY → ADOPTED).
  - Allows admin override for ADOPTED → AVAILABLE (return scenario).
- **Transition Validation:**
  - Centralized validator for all status changes.
  - Throws clear errors for invalid transitions.
  - Logs all status changes for audit trail.
- **API Endpoints:**
  - `PATCH /pets/:id/status`: Update pet status with validation and audit logging.
  - `GET /pets/:id/transitions`: Get allowed transitions and current status for a pet.
  - `GET /pets/:id/transitions/allowed`: Get allowed transitions for the current user (role-aware).
- **Swagger Documentation:**
  - All endpoints are fully documented and visible in Swagger UI.
  - Request/response schemas and examples included.
- **Test Coverage:**
  - Unit tests for all valid and invalid transitions.
  - Tests for admin overrides and edge cases.

## Acceptance Criteria
- Valid transitions work as expected.
- Invalid transitions are blocked with clear error messages.
- Admin can override certain restrictions.
- Status changes are logged.
- All endpoints are documented in Swagger.
- Unit tests cover all scenarios.

## Closes
- #17 Pet Status Lifecycle

---

**Please review the implementation and test the endpoints via Swagger UI (`/api/docs`).**

