

Copilot Chat
Fixing job failure in TypeScript
Please find a solution for this failing job. Use the logs, job definition, and any referenced files where the failure occurred. Keep your response focused on the solution and include code suggestions when appropriate.

Job 83893217439 in amina69/PetAd-backend

View file src/main.ts
Failure (root cause)

TypeScript error TS2307: src/main.ts imports ./jobs/dashboard/bull-board but the module/file cannot be found at build time. The compiler stops with "Cannot find module './jobs/dashboard/bull-board' or its corresponding type declarations."
Quick fixes (choose one)

Add a minimal/placeholder module so the project compiles (fastest)
Create src/jobs/dashboard/bull-board.ts with a no-op export. This resolves the missing import immediately and is safe for CI while you implement the dashboard.
Example (minimal stub) File: src/jobs/dashboard/bull-board.ts

ts
import { INestApplication } from '@nestjs/common';

export function setupBullBoard(app: INestApplication): void {
  // No-op by default (CI / environments where bull-board is not configured)
  // Enable by setting BULL_BOARD_ENABLED=true and implement real setup below.
  if (!process.env.BULL_BOARD_ENABLED) return;

  // TODO: add actual bull-board setup here when ready.
}
Implement the actual bull-board integration (recommended if you want the feature)
Place a real implementation at src/jobs/dashboard/bull-board.ts and export setupBullBoard(app).
Example uses @bull-board packages; adjust imports to match the version in package.json.
Example (starter implementation) File: src/jobs/dashboard/bull-board.ts

ts
import { INestApplication } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import express from 'express';
import { Queue } from 'bull';

export function setupBullBoard(app: INestApplication): void {
  if (!process.env.BULL_BOARD_ENABLED) return;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  // Example: register queues here. Replace `myQueue` with actual queue instances.
  // import or get your queue instances and map to BullAdapter
  // const { myQueue } = require('../path/to/queues');
  // createBullBoard({ queues: [ new BullAdapter(myQueue) ], serverAdapter });

  // Mount to Nest's express instance
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;
  expressApp.use('/admin/queues', serverAdapter.getRouter());
}
Notes:

Install the required packages matching their versions: @bull-board/api, @bull-board/express, and bull (or bullmq if using that). Update the adapters according to the bull-board version you choose.
Replace the placeholder queue registration with actual queue instances from your app.
If the file exists but under a different path or name
Confirm the file path and casing: src/jobs/dashboard/bull-board.ts or src/jobs/dashboard/bull-board/index.ts.
If it's index.ts inside the folder, import is valid; otherwise change import in src/main.ts to the correct relative path.
Example: if file is src/jobs/dashboard/bull-board/index.ts you can still import './jobs/dashboard/bull-board' — but if the file is named bullBoard.ts or BullBoard.ts, change either filename or import.
Other notes and recommendations

After adding the file, run tsc locally or yarn/npm build to verify the error is resolved.
Prefer the minimal stub if you want to unblock CI quickly; then follow up with a full implementation and tests.
If this feature is optional for CI, you can gate it with an environment variable (BULL_BOARD_ENABLED) so the app still runs in CI without bull-board dependencies.
The Node deprecation message in the logs is informational and not the cause of the TS error.
What to commit

Add the new file (src/jobs/dashboard/bull-board.ts) with either the minimal stub or the full implementation and push to the branch/PR. Re-run CI.
If you want, I can:

Provide a ready-to-commit PR patch for the minimal stub (include exact file contents).
Provide the full bull-board implementation tailored to the project's queue setup if you point me to where queues are created/registered.
provide the full implementation

View search results for content:bull-board OR content:@bull-board OR content:BullAdapter OR content:createBullBoard OR content:BullModule OR content:Queue in repo:amina69/PetAd-backend

create_or_update_file
I'm waiting for you to accept the confirmation dialog so I can commit the full implementation to src/jobs/dashboard/bull-board.ts and continue (push the change and re-run CI).

 onakijames-droid accepted the action

create_or_update_file
Direct fix — full bull-board implementation (ready to add)

I implemented a complete, runtime-safe Bull Board setup that:

Is gated by BULL_BOARD_ENABLED so CI / production can opt-out.
Loads @bull-board packages dynamically (so missing dev deps won’t fail TypeScript build).
Registers the existing notifications BullMQ queue (uses your queue config).
Mounts the UI at /admin/queues when using Nest’s default Express adapter.
Since I can't push to the repo (permission denied), add this file to your branch at src/jobs/dashboard/bull-board.ts.

src/jobs/dashboard/bull-board.ts
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { NOTIFICATION_QUEUE_NAME, getRedisConnection } from '../queues/queue.config';

/**
Install required packages (choose npm or pnpm)

npm:
npm install @bull-board/api @bull-board/express bullmq
pnpm:
pnpm add @bull-board/api @bull-board/express bullmq
Notes:

bullmq is already used in the project (your code imports bullmq). Installing it is required for the dashboard adapter to talk to your queues.
The adapter import path used is @bull-board/api/bullMQAdapter which matches recent bull-board v4 layout. If you use a different bull-board version, adjust imports/adapters accordingly.
Enable the dashboard

Add BULL_BOARD_ENABLED=true to your environment (local .env or CI if you want to enable the UI in an environment).
Ensure REDIS_URL is set (getRedisConnection throws otherwise).
How to apply the change locally / on the branch (example)

Create file and commit:

git checkout -b feat/bull-board
(create src/jobs/dashboard/bull-board.ts with the content above)
git add src/jobs/dashboard/bull-board.ts
git commit -m "feat(jobs): add bull-board dashboard setup"
git push origin feat/bull-board
Open a PR or push to the branch used by CI.
Install packages and build:

npm install
npm run build (or pnpm build / tsc)
CI notes and verification

After adding file and packages, CI TypeScript error TS2307 (Cannot find module './jobs/dashboard/bull-board') will be resolved.
If CI is configured without REDIS_URL or ConfigService in the runner environment, nothing breaks because the dashboard is gated by BULL_BOARD_ENABLED (default off). If you enable BULL_BOARD_ENABLED in CI, set REDIS_URL to a working Redis URL.
If your app uses Fastify, the mounting code falls back with a warning because this implementation expects Express. If you want bull-board with Fastify, we can adapt to register the UI via the Fastify adapter.
Why I used dynamic require

The build error originally came from a missing module import. Loading bull-board at runtime avoids adding a compile-time dependency, which is helpful for CI or environments where the dashboard packages aren't installed. If you prefer a static import, replace requires with normal imports and add the packages to package.json.
Search results / context

I inspected your queue/worker code (notification queue, worker, processor) to register the notifications queue in the UI. My code uses NOTIFICATION_QUEUE_NAME and getRedisConnection from src/jobs/queues/queue.config.ts.
The code search I ran may be incomplete — view more results in the repository here:
https://github.com/amina69/PetAd-backend/search?q=bull-board
I attempted to push this file to your repo but got permission denied. If you want, I can:

Produce a patch/PR content you can apply locally (diff or patch file).
Adjust the implementation to mount for Fastify instead of Express.
Add tests or a small README entry for enabling the dashboard.
Which would you like next?

add a README.md file for the dashboard
Direct answer — README content for the dashboard (ready to add to src/jobs/dashboard/README.md)

I can't push to your repo from here (permission denied). Below is a ready-to-commit README file you can add to src/jobs/dashboard/README.md. After the file block I include the exact git commands to add & push the file.

src/jobs/dashboard/README.md
# Bull Board (Queue Dashboard)

This directory contains the Bull Board integration used to monitor the application's BullMQ queues.

The dashboard is optional and disabled by default. When enabled it mounts a Bull Board UI at `/admin/queues` (Express) and registers the `notifications` queue used by the Jobs module.

Using pnpm

bash
pnpm add @bull-board/api @bull-board/express bullmq
Notes:

bullmq is already used by the project for workers/queues; ensure version compatibility.
The README implementation expects the @bull-board/api/bullMQAdapter adapter path used by bull-board v4+. If you use a different bull-board version, update imports/adapters accordingly.
Environment
BULL_BOARD_ENABLED (default: unset/false)
Set to true to enable the dashboard.
REDIS_URL (required if BULL_BOARD_ENABLED=true)
Example: redis://localhost:6379
Important: The integration will call the project's ConfigService to read REDIS_URL via getRedisConnection. If REDIS_URL is not set and the dashboard is enabled, initialization will fail.

Security and recommended deployment practices
The dashboard exposes operational data and should be restricted:

Do not enable BULL_BOARD_ENABLED in public-facing production without protections.
Options to secure the dashboard:
Enable only in private environments (developer machines, internal admin network).
Place behind an authenticated reverse proxy (OAuth, Basic Auth, or SSO).
Add a route guard to Nest before mounting (or mount only on an admin-only express sub-app).
If using Kubernetes, expose the service only on an internal cluster IP.
Example: only enable in development

env
# .env.development
BULL_BOARD_ENABLED=true
REDIS_URL=redis://localhost:6379
In CI or production ensure BULL_BOARD_ENABLED is unset or false.

Fastify users
If your Nest application uses Fastify (FastifyAdapter) the current implementation will log a warning and skip mounting. To support Fastify you can:

Use the @bull-board/express adapter as an independent express app and mount it via an HTTP proxy.
Or add support using adapters or the raw router export (requires custom wiring).
Adding other queues
To register additional queues with the dashboard:

Import or instantiate the additional Queue objects (BullMQ).
Add new BullMQAdapter(yourQueue) into the createBullBoard({ queues: [...] }) call.
Example:

ts
createBullBoard({
  queues: [
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(otherQueue),
  ],
  serverAdapter,
});
Quick troubleshooting
TS2307 "Cannot find module './jobs/dashboard/bull-board'": ensure the file exists at src/jobs/dashboard/bull-board.ts.
"Bull Board packages not available": install the packages or keep BULL_BOARD_ENABLED unset.
"Could not mount bull-board: unsupported HTTP adapter": your app uses Fastify - see the Fastify users section.
Example: enable locally
Install packages:
bash
npm install @bull-board/api @bull-board/express bullmq
Add to .env:
env
BULL_BOARD_ENABLED=true
REDIS_URL=redis://localhost:6379
Start app:
bash
npm run start:dev
Open: http://localhost:3000/admin/queues
Contact / Next steps
If you'd like:

A Fastify-compatible mounting alternative.
A route guard example that restricts access to admin users.
A small unit/integration test for the dashboard initialization.
Please open a PR or tell me which option you prefer and I can provide code.

Code

Git commands to add & push the file (example)
1. Create a branch and add the file:
```bash
git checkout -b feat/bull-board-readme
mkdir -p src/jobs/dashboard
# create src/jobs/dashboard/README.md with the content above (e.g. via your editor)
git add src/jobs/dashboard/README.md
git commit -m "docs(jobs): add README for bull-board dashboard"
git push origin feat/bull-board-readme
Open a PR from feat/bull-board-readme to your target branch.
If you want, I can:

Produce a patch file (unified diff) you can apply locally.
Update the README to a different path (e.g., docs/bull-board.md) or modify content for stricter security guidance.
Which would you like next?

add a README.md file for the dashboard
Content preview
Workbench
Press Delete to close the focussed tab.

src/jobs/dashboard/bull-board.ts

src/jobs/dashboard/README.md


29 lines · 1 KB

src/jobs/dashboard/README.md file contents
  1
  2
  3
  4
  5
  6
  7
  8
  9
 10
 11
 12
 13
 14
 15
 16
 17
 18
 19
 20
 21
 22
 23
 24
 25
 26
 27
 28
 29
# Bull Board (Queue Dashboard)

This directory contains the Bull Board integration used to monitor the application's BullMQ queues.

The dashboard is optional and disabled by default. When enabled it mounts a Bull Board UI at `/admin/queues` (Express) and registers the `notifications` queue used by the Jobs module.

## Purpose

- Provide a lightweight UI for inspecting job queues (jobs, attempts, failures).
- Safe to leave disabled in CI/production; enable only where you need visibility.

## Implementation summary

- File: `src/jobs/dashboard/bull-board.ts`
- Exported function: `setupBullBoard(app: INestApplication): void`
- Behavior:
  - Guarded by env var `BULL_BOARD_ENABLED` (off by default).
  - Loads `@bull-board` packages at runtime (dynamic require) to avoid hard build-time dependency.
  - Uses `NOTIFICATION_QUEUE_NAME` and `getRedisConnection` from `src/jobs/queues/queue.config.ts`.
  - Mounts UI at `/admin/queues` when Nest uses the default Express HTTP adapter.
  - Falls back with warnings if packages are missing or if the HTTP adapter is not Express (Fastify).

## Prerequisites

Install the required packages (choose npm or pnpm):

Using npm
```bash
npm install @bull-board/api @bull-board/express bullmq
Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
Skip to content
amina69
PetAd-backend
Repository navigation
Code
Issues
5
 (5)
Pull requests
6
 (6)
Agents
Actions
Projects
Security and quality
Insights
Owner avatar
PetAd-backend
Public
amina69/PetAd-backend
Go to file
t
T
Name		
amina69
amina69
Merge pull request #117 from Clinton6801/feat/60-custody-lifecycle-st…
2d093a8
 · 
2 days ago
.github
feat: implement pet CRUD operations(#12)
4 months ago
.vscode
Rate limiting implemented
3 months ago
docs
Implemented #17 Pet Status Lifecycle
4 months ago
kiro-specs/custody-agreements
feat: implement custody agreements API endpoint
4 months ago
prisma
fix: add CUSTODY_CANCELLED to EventType enum in schema.prisma
2 days ago
src
feat(#60): implement custody lifecycle state machine with transition …
2 days ago
test
feat(pets): derive pet availability dynamically from adoption and cus…
4 months ago
.dockerignore
reset shcema
4 months ago
.env.example
Revert "feat: user database schema OAuth fields + Google authentication"
3 weeks ago
.gitignore
fixes
4 months ago
.prettierrc
fixes
4 months ago
CONTRIBUTING.md
fixes
4 months ago
CUSTODY_STATE_MACHINE_IMPLEMENTATION.md
feat(#60): implement custody lifecycle state machine with transition …
2 days ago
Dockerfile
Logging service has been implemented and is saving to prisma database
4 months ago
FEATURES_13_16_IMPLEMENTATION.md
impl the issue
4 months ago
FINAL_TEST_REPORT.md
impl the issue
4 months ago
ISSUE_22_IMPLEMENTATION.md
feat: implement admin approval/rejection endpoints for adoptions (#22)
28 days ago
ISSUE_22_SUMMARY.md
docs: add verification checklist and implementation summary for issue #…
28 days ago
PAGINATION_IMPLEMENTATION.md
implemented pagination
4 months ago
PAGINATION_QUICK_REFERENCE.md
implemented pagination
4 months ago
README.md
Implemented Swagger docs for the available controller and endpoints
4 months ago
TEST_STATUS_REPORT.md
impl the issue
4 months ago
VERIFICATION_CHECKLIST.md
docs: add verification checklist and implementation summary for issue #…
28 days ago
docker-compose.yml
Logging service has been implemented and is saving to prisma database
4 months ago
eslint.config.mjs
fixes
4 months ago
nest-cli.json
fixes
4 months ago
package-lock.json
Revert "feat: user database schema OAuth fields + Google authentication"
3 weeks ago
package.json
Revert "feat: user database schema OAuth fields + Google authentication"
3 weeks ago
prisma.config.ts
feat(auth): implement role-based access control (RBAC) with RolesGuar…
4 months ago
tsconfig.build.json
fixes
4 months ago
tsconfig.json
Logger app again checked and tested
3 months ago
Repository files navigation
README
Contributing
PetAd Core — NestJS Backend API 🐾
License: MIT TypeScript NestJS PostgreSQL Docker

Production-grade NestJS backend for PetAd — a blockchain-backed platform enabling secure pet adoption and temporary custody with verifiable on-chain guarantees. Exposes REST APIs for the frontend and orchestrates escrow workflows using the PetAd Stellar SDK.

📋 Table of Contents
Architecture Overview
Key Responsibilities
Features
Tech Stack
Prerequisites
Getting Started
Installation
Environment Setup
Database Setup
Running the Server
Project Structure
Escrow & Trust Flow
API Documentation
Docker Services
Scripts
Testing
Security
Deployment
Roadmap
Contributing
License
🏗️ Architecture Overview
PetAd Core acts as the central coordinator in the PetAd ecosystem, bridging the user-facing frontend with the blockchain trust layer.

System Flow
┌─────────────────────────────────────────────────────────┐
│              Frontend (React)                           │
│           User Interface Layer                          │
└───────────────────┬─────────────────────────────────────┘
                    │
                    │ REST API (HTTP/JSON)
                    ▼
┌─────────────────────────────────────────────────────────┐
│           PetAd Core Backend (NestJS)                   │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Controllers (REST endpoints)                    │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Services (Business logic)                       │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Escrow Orchestration Layer                      │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Event Logging (Audit trail)                     │  │
│  └──────────────────────────────────────────────────┘  │
└────┬──────────────────┬──────────────────┬─────────────┘
     │                  │                  │
     ▼                  ▼                  │
┌──────────┐     ┌──────────┐            │
│PostgreSQL│     │  Redis   │            │
│(Prisma)  │     │(Queue)   │            │
└──────────┘     └──────────┘            │
                                          ▼
                               ┌─────────────────────┐
                               │ PetAd Stellar SDK   │
                               │ (Blockchain Layer)  │
                               └──────────┬──────────┘
                                          │
                                          ▼
                               ┌─────────────────────┐
                               │ Stellar Blockchain  │
                               │ (Trust Layer)       │
                               └─────────────────────┘
Design Principles
🔒 Security First - No private keys exposed to clients
📊 Event Logging - Audit trail of all operations
⚡ Async Operations - Background jobs for blockchain interactions
🎯 Domain-Driven - Clear separation of concerns
🔄 Idempotent - Safe to retry all operations
🎯 Key Responsibilities
The backend service handles:

Core Features (Phase 1 - Current)
✅ Authentication & Authorization

JWT-based authentication
Role-based access control (USER, ADMIN, SHELTER)
Session management
Password hashing with bcrypt
✅ Pet Management

CRUD operations for pet listingshttps://github.com/EzeanoroEbuka/PetAd-backend.git
Search and filtering
Image upload and storage
Availability status tracking
✅ Adoption Workflows

Adoption request submission
Document upload and storage
Status tracking (PENDING → APPROVED → COMPLETED)
Admin approval system
✅ Temporary Custody

Time-bound custody agreement creation
Deposit amount calculation
Duration tracking
Status management
✅ Escrow Orchestration

Creates escrow accounts via Stellar SDK
Coordinates with blockchain layer
Monitors transaction confirmations
Updates internal records
✅ Event Logging

Logs all significant operations
Provides audit trail
Stores transaction references
✅ Background Jobs

Blockchain confirmation polling
Notification delivery
Scheduled task execution
Planned Features (See Roadmap)
📋 Advanced event sourcing, trust scoring, and reputation systems are planned for future phases.

✨ Features
✅ RESTful API - Clean, documented endpoints
✅ JWT Authentication - Secure token-based auth
✅ Database Migrations - Version-controlled schema with Prisma
✅ Background Jobs - BullMQ for async tasks
✅ File Uploads - Secure document storage
✅ API Validation - Request/response validation with DTOs
✅ Error Handling - Standardized error responses
✅ Logging - Structured logging
✅ Health Checks - Readiness and liveness probes
✅ Swagger Docs - Auto-generated API documentation
✅ Docker Support - Containerized deployment
🛠️ Tech Stack
Core Framework
Technology	Version	Purpose
NestJS	10+	Progressive Node.js framework
TypeScript	5.0+	Type-safe development
Node.js	20+	Runtime environment
Database & Storage
Technology	Version	Purpose
PostgreSQL	16+	Primary relational database
Prisma ORM	Latest	Type-safe database client
Redis	7+	Caching and job queues
Blockchain Integration
Technology	Purpose
PetAd Stellar SDK	Blockchain operations (escrow, transactions)
@petad/stellar-sdk	npm package for Stellar integration
Background Processing
Technology	Purpose
BullMQ	Job queue management
Bull Board	Queue monitoring dashboard
DevOps
Technology	Purpose
Docker	Containerization
Docker Compose	Local development orchestration
GitHub Actions	CI/CD pipeline
📦 Prerequisites
Ensure you have the following installed:

Node.js >= 20.0.0
npm >= 10.0.0 or pnpm >= 8.0.0
Docker >= 24.0.0
Docker Compose >= 2.0.0
PostgreSQL >= 16.0 (or use Docker)
Redis >= 7.0 (or use Docker)
Verify installations:

node --version
npm --version
docker --version
docker-compose --version
🚀 Getting Started
Installation
Clone the repository
git clone https://github.com/amina69/PetAd-Backend.git
cd petad-core
Install dependencies
npm install
Or using pnpm:

pnpm install
Install PetAd Stellar SDK
npm install @petad/stellar-sdk
Environment Setup
Create a .env file in the project root:

# Database Configuration
DATABASE_URL=postgresql://petad:petad@localhost:5432/petad

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Stellar Blockchain
STELLAR_NETWORK=testnet
STELLAR_SECRET_KEY=S...           # Backend signing key (CRITICAL)
STELLAR_PUBLIC_KEY=G...           # Backend public address
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org

# Authentication
JWT_SECRET=your-super-secure-jwt-secret-min-32-characters
JWT_EXPIRATION=7d

# Application
PORT=3000
NODE_ENV=development

# File Upload
MAX_FILE_SIZE=10485760            # 10MB in bytes
UPLOAD_DEST=./uploads

# Background Jobs
QUEUE_CONCURRENCY=5
JOB_ATTEMPTS=3
JOB_BACKOFF_DELAY=5000

# Monitoring (Optional)
SENTRY_DSN=
LOG_LEVEL=debug                   # debug | info | warn | error

# Email (Optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
Create .env from example:

cp .env.example .env
# Edit .env with your values
Database Setup
Using Docker Compose (Recommended)
Start PostgreSQL and Redis:

docker-compose up -d postgres redis
Manual Setup
If not using Docker:

# Create PostgreSQL database
createdb petad

# Start Redis
redis-server
Run Migrations
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed database with sample data (optional)
npm run seed
Open Prisma Studio (Database GUI)
npx prisma studio
# Opens at http://localhost:5555
Running the Server
Development Mode (Hot Reload)
npm run start:dev
Production Build
npm run build
npm run start:prod
Debug Mode
npm run start:debug
Server will be available at:

http://localhost:3000
Health check:

curl http://localhost:3000/health
Expected response:

{
  "status": "ok",
  "database": "connected",
  "redis": "connected"
}
📁 Project Structure
src/
├── auth/                        # Authentication & authorization
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   └── dto/
│       ├── login.dto.ts
│       └── register.dto.ts
│
├── users/                       # User management
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── users.repository.ts
│   └── entities/
│       └── user.entity.ts
│
├── pets/                        # Pet listings & management
│   ├── pets.controller.ts
│   ├── pets.service.ts
│   ├── pets.repository.ts
│   └── dto/
│       ├── create-pet.dto.ts
│       └── search-pets.dto.ts
│
├── adoption/                    # Adoption workflows
│   ├── adoption.controller.ts
│   ├── adoption.service.ts
│   ├── adoption.state-machine.ts
│   └── dto/
│       ├── create-adoption.dto.ts
│       └── approve-adoption.dto.ts
│
├── custody/                     # Temporary custody
│   ├── custody.controller.ts
│   ├── custody.service.ts
│   ├── custody.scheduler.ts
│   └── entities/
│       └── custody.entity.ts
│
├── escrow/                      # Escrow orchestration
│   ├── escrow.service.ts        # Main escrow logic
│   ├── escrow.repository.ts
│   ├── escrow.orchestrator.ts   # Coordinates with Stellar SDK
│   └── dto/
│       ├── create-escrow.dto.ts
│       └── release-escrow.dto.ts
│
├── events/                      # Event logging
│   ├── events.service.ts
│   ├── events.repository.ts
│   └── types/
│       └── event.types.ts
│
├── stellar/                     # Blockchain integration layer
│   ├── stellar.module.ts
│   ├── stellar.service.ts       # Wrapper for @petad/stellar-sdk
│   ├── transaction.monitor.ts   # Polls blockchain confirmations
│   └── utils/
│       └── keypair.manager.ts
│
├── jobs/                        # Background workers
│   ├── jobs.module.ts
│   ├── processors/
│   │   ├── blockchain-confirmation.processor.ts
│   │   └── notification.processor.ts
│   └── queues/
│       └── queue.config.ts
│
├── documents/                   # Document management
│   ├── documents.service.ts
│   ├── upload.service.ts
│   └── storage/
│
├── notifications/               # Email & push notifications
│   ├── notifications.service.ts
│   ├── email.service.ts
│   └── templates/
│
├── common/                      # Shared utilities
│   ├── decorators/
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── guards/
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── utils/
│
├── config/                      # Configuration management
│   ├── configuration.ts
│   ├── database.config.ts
│   └── validation.schema.ts
│
├── prisma/                      # Database layer
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── main.ts                      # Application entry point
└── app.module.ts                # Root module
Key Directories
escrow/ - Handles escrow operations via Stellar SDK
stellar/ - Abstraction layer wrapping @petad/stellar-sdk
events/ - Event logging for audit trail
jobs/ - Background workers for async operations
🔄 Escrow & Trust Flow
The backend never exposes private keys to clients. All blockchain operations are server-signed.

Escrow Lifecycle
┌─────────────────────────────────────────────────────────┐
│            Adoption Escrow Workflow                     │
└─────────────────────────────────────────────────────────┘

1. Frontend: User submits adoption request
   ↓
   POST /adoption/requests
   
2. Backend: Validates request
   ↓
   Creates internal adoption record (status: PENDING)
   
3. Admin: Approves adoption
   ↓
   PATCH /adoption/:id/approve
   
4. Backend: Orchestrates escrow creation
   ↓
   calls escrowOrchestrator.createEscrow({
     adopterPublicKey,
     ownerPublicKey,
     amount
   })
   ↓
   internally calls @petad/stellar-sdk
   ↓
   Creates multisig escrow on Stellar
   
5. Blockchain: Escrow account created
   ↓
   Transaction confirmed on Stellar network
   
6. Background Job: Monitors confirmation
   ↓
   blockchain-confirmation.processor polls Horizon API
   ↓
   Updates adoption status: ESCROW_FUNDED
   
7. Backend: Logs event
   ↓
   events.create({
     type: 'ESCROW_CREATED',
     adoptionId,
     transactionHash
   })
   
8. Adoption Complete: Escrow released
   ↓
   POST /adoption/:id/complete
   ↓
   calls escrowOrchestrator.releaseEscrow()
   ↓
   Funds transferred to shelter + platform
Code Example
// escrow/escrow.orchestrator.ts
import { StellarSDK } from '@petad/stellar-sdk';

@Injectable()
export class EscrowOrchestrator {
  constructor(
    private readonly stellarSDK: StellarSDK,
    private readonly eventsService: EventsService
  ) {}

  async createEscrow(params: CreateEscrowParams): Promise<EscrowAccount> {
    // 1. Create escrow via SDK
    const escrow = await this.stellarSDK.escrow.createAccount({
      adopterPublicKey: params.adopterKey,
      ownerPublicKey: params.ownerKey,
      depositAmount: params.amount,
      metadata: {
        adoptionId: params.adoptionId,
        petId: params.petId
      }
    });

    // 2. Store in database
    const dbEscrow = await this.escrowRepository.create({
      accountId: escrow.accountId,
      transactionHash: escrow.transactionHash,
      status: 'CREATED'
    });

    // 3. Log event
    await this.eventsService.create({
      type: 'ESCROW_CREATED',
      aggregateId: params.adoptionId,
      payload: {
        escrowAccountId: escrow.accountId,
        txHash: escrow.transactionHash
      }
    });

    // 4. Schedule background confirmation job
    await this.jobsQueue.add('monitor-confirmation', {
      transactionHash: escrow.transactionHash,
      escrowId: dbEscrow.id
    });

    return dbEscrow;
  }
}
📚 API Documentation
Swagger Documentation
Interactive API docs are available at:

http://localhost:3000/api
Base URL
http://localhost:3000/api/v1
Authentication
Protected endpoints require a JWT token in the Authorization header:

Authorization: Bearer <your-jwt-token>
Key Endpoints
Authentication
Method	Endpoint	Description	Auth Required
POST	/auth/register	Create new user account	❌
POST	/auth/login	Login and receive JWT	❌
POST	/auth/logout	Invalidate token	✅
GET	/auth/me	Get current user profile	✅
Pets
Method	Endpoint	Description	Auth Required
GET	/pets	List all available pets	❌
GET	/pets/:id	Get pet details	❌
POST	/pets	Create new pet listing	✅ (Shelter/Admin)
PATCH	/pets/:id	Update pet details	✅ (Shelter/Admin)
DELETE	/pets/:id	Remove pet listing	✅ (Admin)
Adoption
Method	Endpoint	Description	Auth Required
POST	/adoption/requests	Submit adoption request	✅
GET	/adoption/requests	List adoption requests	✅
GET	/adoption/requests/:id	Get adoption details	✅
PATCH	/adoption/:id/approve	Approve adoption (admin)	✅ (Admin)
POST	/adoption/:id/complete	Complete adoption	✅ (Admin)
Custody
Method	Endpoint	Description	Auth Required
POST	/custody/create	Create custody agreement	✅
GET	/custody	List custody agreements	✅
POST	/custody/:id/complete	Complete custody period	✅
Escrow
Method	Endpoint	Description	Auth Required
GET	/escrow/:id	Get escrow details	✅
GET	/escrow/:id/status	Check blockchain status	✅
Example Request
# Login
curl -X POST http://localhost:3000/api/v1/auth/login   -H "Content-Type: application/json"   -d '{
    "email": "user@example.com",
    "password": "password123"
  }'

# Response
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "role": "USER"
  }
}

# Use token for authenticated requests
curl -X GET http://localhost:3000/api/v1/pets   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
🐳 Docker Services
The docker-compose.yml includes all necessary infrastructure:

Services
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: petad
      POSTGRES_USER: petad
      POSTGRES_PASSWORD: petad
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  backend:
    build: .
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./src:/app/src
      - ./uploads:/app/uploads

  prisma-studio:
    image: timothyjmiller/prisma-studio:latest
    environment:
      DATABASE_URL: postgresql://petad:petad@postgres:5432/petad
    ports:
      - "5555:5555"
    depends_on:
      - postgres
Start All Services
docker-compose up -d
Stop All Services
docker-compose down
View Logs
docker-compose logs -f backend
Rebuild After Changes
docker-compose up -d --build
📜 Scripts
Command	Description
npm run start	Start application
npm run start:dev	Development mode with hot reload
npm run start:debug	Debug mode with inspector
npm run start:prod	Production mode
npm run build	Build for production
npm run test	Run unit tests
npm run test:watch	Watch mode for tests
npm run test:cov	Generate coverage report
npm run test:e2e	End-to-end tests
npm run lint	Lint code with ESLint
npm run format	Format code with Prettier
npm run prisma:migrate	Run database migrations
npm run prisma:generate	Generate Prisma Client
npm run prisma:studio	Open Prisma Studio
npm run seed	Seed database with sample data
🔒 Security
Security Measures
✅ No Private Keys Exposed - All blockchain signing server-side
✅ JWT Authentication - Token-based auth with expiration
✅ RBAC - Role-based access control
✅ Input Validation - Request validation with class-validator
✅ SQL Injection Prevention - Prisma ORM with parameterized queries
✅ Rate Limiting - Prevents brute force attacks
✅ CORS Configuration - Whitelist allowed origins
✅ Helmet - Security headers
✅ Event Logging - Audit trail of operations
🚀 Deployment
Production Checklist
 Set NODE_ENV=production
 Use strong JWT_SECRET (32+ characters)
 Store STELLAR_SECRET_KEY in secrets manager
 Enable HTTPS
 Configure CORS for production domain
 Set up monitoring (Sentry, DataDog)
 Configure backup strategy for PostgreSQL
 Enable rate limiting
 Set up CI/CD pipeline
Recommended Stack
Component	Service
Backend	AWS ECS / Google Cloud Run / Railway
Database	AWS RDS PostgreSQL / Supabase
Redis	AWS ElastiCache / Upstash
Monitoring	Sentry + DataDog
🗺️ Roadmap
Phase 1: Core Features ✅ (Current)
Status: In Development

✅ User authentication & authorization
✅ Pet listings CRUD
✅ Basic adoption workflows
✅ Custody agreement creation
✅ Escrow orchestration via SDK
✅ Document upload
✅ Event logging
Phase 2: Advanced Workflows 🚧 (Next)
Target: Q2 2026

📋 Automated escrow settlement
📋 Enhanced status tracking
📋 Multi-party approval flows
📋 Dispute initiation system
📋 Notification system improvements
📋 File verification
Phase 3: Event Sourcing & Trust Layer 📅 (Planned)
Target: Q3-Q4 2026

📅 Event Sourcing Architecture

Append-only event ledger
Complete pet movement tracking
Event replay capability
Blockchain hash anchoring for events
📅 Trust & Reputation System

Adopter trust history tracking
Completed agreements counter
Dispute records and resolution history
Verifiable trust profiles
Reputation scoring algorithm
Trust badges and certifications
Phase 4: Analytics & Insights 🔮 (Future)
Target: 2027

🔮 Platform metrics dashboard
🔮 Adoption success rate analytics
🔮 Predictive insights
🔮 Shelter performance metrics
🔮 Geographic adoption patterns
🤝 Contributing
We welcome community contributions!

See CONTRIBUTING.md for:

Branch strategy
Code style guidelines
Pull request workflow
Issue reporting
Good First Issues
Looking to contribute? Check out issues labeled:

good first issue - Perfect for newcomers
help wanted - Community contributions needed
documentation - Improve our docs
📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

🙏 Acknowledgments
Built with ❤️ for transparent, trustworthy pet adoption
Powered by Stellar blockchain technology
Inspired by the mission to connect pets with loving homes
🔗 Related Projects
Frontend: petad-frontend - React web application
Stellar SDK: petad-chain - Blockchain SDK
Made with 🐾 by the PetAd Team

Building trust infrastructure for pet adoption, one API at a time.

About
PetAd.

petad-seven.vercel.app
Resources
 Readme
Contributing
 Contributing
 Activity
Stars
 16 stars
Watchers
 0 watching
Forks
 35 forks
Report repository
Releases
No releases published
Packages
No packages published
Contributors
23
@amina69
@omonuj
@samad13
@githoboman
@EzeanoroEbuka
@romeoscript
@johdanike
@devxsameer
@Depo-dev
@kingjosmel
@iGEORGE17
@Cjay-Cyber-2
@Alu-card19
@Miracle656
+ 9 contributors
Languages
TypeScript
99.3%
 
Other
0.7%
Footer
© 2026 GitHub, Inc.
Footer navigation
Terms
Privacy
Security
Status
Community
Docs
Contact
Manage cookies
Do not share my personal information
