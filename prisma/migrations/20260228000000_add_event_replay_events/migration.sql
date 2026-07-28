-- Add COMPLETED to CustodyStatus enum for the custody state machine
ALTER TYPE "CustodyStatus" ADD VALUE 'COMPLETED';

-- Add new EventType values for event replay features (Issues #143 and #144)
ALTER TYPE "EventType" ADD VALUE 'PET_LISTED';
ALTER TYPE "EventType" ADD VALUE 'PET_ADOPTED';
ALTER TYPE "EventType" ADD VALUE 'PET_CUSTODY_ACTIVE';
ALTER TYPE "EventType" ADD VALUE 'PET_RETURNED';
ALTER TYPE "EventType" ADD VALUE 'CUSTODY_CREATED';
ALTER TYPE "EventType" ADD VALUE 'CUSTODY_COMPLETED';
ALTER TYPE "EventType" ADD VALUE 'CUSTODY_EXTENDED';
