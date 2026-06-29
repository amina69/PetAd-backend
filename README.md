# PetAd Core — NestJS Backend API 🐾

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10+-E0234E.svg)](https://nestjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

Production-grade NestJS backend for **PetAd** — a blockchain-backed platform enabling secure pet adoption and temporary custody with verifiable on-chain guarantees. Exposes REST APIs for the frontend and orchestrates escrow workflows using the PetAd Stellar SDK.

---

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Key Responsibilities](#key-responsibilities)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Environment Setup](#environment-setup)
  - [Database Setup](#database-setup)
  - [Running the Server](#running-the-server)
- [Project Structure](#project-structure)
- [Escrow & Trust Flow](#escrow--trust-flow)
- [API Documentation](#api-documentation)
- [Docker Services](#docker-services)
- [Scripts](#scripts)
- [Testing](#testing)
- [Security](#security)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## 🏗️ Architecture Overview

**PetAd Core** acts as the central coordinator in the PetAd ecosystem, bridging the user-facing frontend with the blockchain trust layer.

### System Flow

```
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
```

### Design Principles

- 🔒 **Security First** - No private keys exposed to clients
- 📊 **Event Logging** - Audit trail of all operations
- ⚡ **Async Operations** - Background jobs for blockchain interactions
- 🎯 **Domain-Driven** - Clear separation of concerns
- 🔄 **Idempotent** - Safe to retry all operations

---

## 🎯 Key Responsibilities

The backend service handles:

### Core Features (Phase 1 - Current)

✅ **Authentication & Authorization**
- JWT-based authentication
- Role-based access control (USER, ADMIN, SHELTER)
- Session management
- Password hashing with bcrypt

✅ **Pet Management**
- CRUD operations for pet listingshttps://github.com/EzeanoroEbuka/PetAd-backend.git
- Search and filtering
- Image upload and storage
- Availability status tracking

✅ **Adoption Workflows**
- Adoption request submission
- Document upload and storage
- Status tracking (PENDING → APPROVED → COMPLETED)
- Admin approval system

✅ **Temporary Custody**
- Time-bound custody agreement creation
- Deposit amount calculation
- Duration tracking
- Status management

✅ **Escrow Orchestration**
- Creates escrow accounts via Stellar SDK
- Coordinates with blockchain layer
- Monitors transaction confirmations
- Updates internal records

✅ **Event Logging**
- Logs all significant operations
- Provides audit trail
- Stores transaction references

✅ **Background Jobs**
- Blockchain confirmation polling
- Notification delivery
- Scheduled task execution

### Planned Features (See Roadmap)

📋 Advanced event sourcing, trust scoring, and reputation systems are planned for future phases.

---

## ✨ Features

- ✅ **RESTful API** - Clean, documented endpoints
- ✅ **JWT Authentication** - Secure token-based auth
- ✅ **Database Migrations** - Version-controlled schema with Prisma
- ✅ **Background Jobs** - BullMQ for async tasks
- ✅ **File Uploads** - Secure document storage
- ✅ **API Validation** - Request/response validation with DTOs
- ✅ **Error Handling** - Standardized error responses
- ✅ **Logging** - Structured logging
- ✅ **Health Checks** - Readiness and liveness probes
- ✅ **Swagger Docs** - Auto-generated API documentation
- ✅ **Docker Support** - Containerized deployment

---

## 🛠️ Tech Stack

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **NestJS** | 10+ | Progressive Node.js framework |
| **TypeScript** | 5.0+ | Type-safe development |
| **Node.js** | 20+ | Runtime environment |

### Database & Storage

| Technology | Version | Purpose |
|------------|---------|---------|
| **PostgreSQL** | 16+ | Primary relational database |
| **Prisma ORM** | Latest | Type-safe database client |
| **Redis** | 7+ | Caching and job queues |

### Blockchain Integration

| Technology | Purpose |
|------------|---------|
| **PetAd Stellar SDK** | Blockchain operations (escrow, transactions) |
| **@petad/stellar-sdk** | npm package for Stellar integration |

### Background Processing

| Technology | Purpose |
|------------|---------|
| **BullMQ** | Job queue management |
| **Bull Board** | Queue monitoring dashboard |

### DevOps

| Technology | Purpose |
|------------|---------|
| **Docker** | Containerization |
| **Docker Compose** | Local development orchestration |
| **GitHub Actions** | CI/CD pipeline |

---

## 📦 Prerequisites

Ensure you have the following installed:

- **Node.js** `>= 20.0.0`
- **npm** `>= 10.0.0` or **pnpm** `>= 8.0.0`
- **Docker** `>= 24.0.0`
- **Docker Compose** `>= 2.0.0`
- **PostgreSQL** `>= 16.0` (or use Docker)
- **Redis** `>= 7.0` (or use Docker)

**Verify installations:**

```bash
node --version
npm --version
docker --version
docker-compose --version
```

---

## 🚀 Getting Started

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/amina69/PetAd-Backend.git
cd petad-core
```

2. **Install dependencies**

```bash
npm install
```

Or using pnpm:

```bash
pnpm install
```

3. **Install PetAd Stellar SDK**

```bash
npm install @petad/stellar-sdk
```

---

### Environment Setup

Create a `.env` file in the project root:

```env
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

# BullMQ Dashboard
# Visit http://localhost:${PORT}/admin/queues to monitor active, completed, and failed jobs.
BULL_BOARD_PATH=/admin/queues

# Monitoring (Optional)
SENTRY_DSN=
LOG_LEVEL=debug                   # debug | info | warn | error

# Email (Optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

**Create `.env` from example:**

```bash
cp .env.example .env
# Edit .env with your values
```

---

### Database Setup

#### Using Docker Compose (Recommended)

Start PostgreSQL and Redis:

```bash
docker-compose up -d postgres redis
```

#### Manual Setup

If not using Docker:

```bash
# Create PostgreSQL database
createdb petad

# Start Redis
redis-server
```

#### Run Migrations

```bash
# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# Seed database with sample data (optional)
npm run seed
```

#### Open Prisma Studio (Database GUI)

```bash
npx prisma studio
# Opens at http://localhost:5555
```

---

### Running the Server

#### Development Mode (Hot Reload)

```bash
npm run start:dev
```

#### Production Build

```bash
npm run build
npm run start:prod
```

#### Debug Mode

```bash
npm run start:debug
```

**Server will be available at:**

```
http://localhost:3000
```

**Health check:**

```bash
curl http://localhost:3000/health
```

**Expected response:**

```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected"
}
```

---

## 📁 Project Structure

```
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
```

### Key Directories

- **`escrow/`** - Handles escrow operations via Stellar SDK
- **`stellar/`** - Abstraction layer wrapping `@petad/stellar-sdk`
- **`events/`** - Event logging for audit trail
- **`jobs/`** - Background workers for async operations

---

## 🔄 Escrow & Trust Flow

The backend **never exposes private keys** to clients. All blockchain operations are server-signed.

### Escrow Lifecycle

```
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
```

### Code Example

```typescript
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
```

---

## 📚 API Documentation

### Swagger Documentation

Interactive API docs are available at:

```
http://localhost:3000/api
```

### Base URL

```
http://localhost:3000/api/v1
```

### Authentication

Protected endpoints require a JWT token in the `Authorization` header:

```bash
Authorization: Bearer <your-jwt-token>
```

### Key Endpoints

#### Authentication

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/auth/register` | Create new user account | ❌ |
| `POST` | `/auth/login` | Login and receive JWT | ❌ |
| `POST` | `/auth/logout` | Invalidate token | ✅ |
| `GET` | `/auth/me` | Get current user profile | ✅ |

#### Pets

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/pets` | List all available pets | ❌ |
| `GET` | `/pets/:id` | Get pet details | ❌ |
| `POST` | `/pets` | Create new pet listing | ✅ (Shelter/Admin) |
| `PATCH` | `/pets/:id` | Update pet details | ✅ (Shelter/Admin) |
| `DELETE` | `/pets/:id` | Remove pet listing | ✅ (Admin) |

#### Adoption

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/adoption/requests` | Submit adoption request | ✅ |
| `GET` | `/adoption/requests` | List adoption requests | ✅ |
| `GET` | `/adoption/requests/:id` | Get adoption details | ✅ |
| `PATCH` | `/adoption/:id/approve` | Approve adoption (admin) | ✅ (Admin) |
| `POST` | `/adoption/:id/complete` | Complete adoption | ✅ (Admin) |

#### Custody

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/custody/create` | Create custody agreement | ✅ |
| `GET` | `/custody` | List custody agreements | ✅ |
| `POST` | `/custody/:id/complete` | Complete custody period | ✅ |

#### Escrow

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/escrow/:id` | Get escrow details | ✅ |
| `GET` | `/escrow/:id/status` | Check blockchain status | ✅ |

### Example Request

```bash
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
```

---

## 🐳 Docker Services

The `docker-compose.yml` includes all necessary infrastructure:

### Services

```yaml
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
```

### Start All Services

```bash
docker-compose up -d
```

### Stop All Services

```bash
docker-compose down
```

### View Logs

```bash
docker-compose logs -f backend
```

### Rebuild After Changes

```bash
docker-compose up -d --build
```

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run start` | Start application |
| `npm run start:dev` | Development mode with hot reload |
| `npm run start:debug` | Debug mode with inspector |
| `npm run start:prod` | Production mode |
| `npm run build` | Build for production |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Watch mode for tests |
| `npm run test:cov` | Generate coverage report |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | Lint code with ESLint |
| `npm run format` | Format code with Prettier |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run seed` | Seed database with sample data |

---
## 🔒 Security

### Security Measures

- ✅ **No Private Keys Exposed** - All blockchain signing server-side
- ✅ **JWT Authentication** - Token-based auth with expiration
- ✅ **RBAC** - Role-based access control
- ✅ **Input Validation** - Request validation with class-validator
- ✅ **SQL Injection Prevention** - Prisma ORM with parameterized queries
- ✅ **Rate Limiting** - Prevents brute force attacks
- ✅ **CORS Configuration** - Whitelist allowed origins
- ✅ **Helmet** - Security headers
- ✅ **Event Logging** - Audit trail of operations

---

## 🚀 Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET` (32+ characters)
- [ ] Store `STELLAR_SECRET_KEY` in secrets manager
- [ ] Enable HTTPS
- [ ] Configure CORS for production domain
- [ ] Set up monitoring (Sentry, DataDog)
- [ ] Configure backup strategy for PostgreSQL
- [ ] Enable rate limiting
- [ ] Set up CI/CD pipeline

### Recommended Stack

| Component | Service |
|-----------|---------|
| **Backend** | AWS ECS / Google Cloud Run / Railway |
| **Database** | AWS RDS PostgreSQL / Supabase |
| **Redis** | AWS ElastiCache / Upstash |
| **Monitoring** | Sentry + DataDog |

---

## 🗺️ Roadmap

### Phase 1: Core Features ✅ (Current)

**Status:** In Development

- ✅ User authentication & authorization
- ✅ Pet listings CRUD
- ✅ Basic adoption workflows
- ✅ Custody agreement creation
- ✅ Escrow orchestration via SDK
- ✅ Document upload
- ✅ Event logging

### Phase 2: Advanced Workflows 🚧 (Next)

**Target:** Q2 2026

- 📋 Automated escrow settlement
- 📋 Enhanced status tracking
- 📋 Multi-party approval flows
- 📋 Dispute initiation system
- 📋 Notification system improvements
- 📋 File verification

### Phase 3: Event Sourcing & Trust Layer 📅 (Planned)

**Target:** Q3-Q4 2026

- 📅 **Event Sourcing Architecture**
  - Append-only event ledger
  - Complete pet movement tracking
  - Event replay capability
  - Blockchain hash anchoring for events

- 📅 **Trust & Reputation System**
  - Adopter trust history tracking
  - Completed agreements counter
  - Dispute records and resolution history
  - Verifiable trust profiles
  - Reputation scoring algorithm
  - Trust badges and certifications

### Phase 4: Analytics & Insights 🔮 (Future)

**Target:** 2027

- 🔮 Platform metrics dashboard
- 🔮 Adoption success rate analytics
- 🔮 Predictive insights
- 🔮 Shelter performance metrics
- 🔮 Geographic adoption patterns

---

## 🤝 Contributing

We welcome community contributions!

See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Branch strategy
- Code style guidelines
- Pull request workflow
- Issue reporting

### Good First Issues

Looking to contribute? Check out issues labeled:
- `good first issue` - Perfect for newcomers
- `help wanted` - Community contributions needed
- `documentation` - Improve our docs

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with ❤️ for transparent, trustworthy pet adoption
- Powered by [Stellar](https://stellar.org) blockchain technology
- Inspired by the mission to connect pets with loving homes
---

## 🔗 Related Projects

- **Frontend:** [petad-frontend](https://github.com/amina69/PetAd-Frontend) - React web application
- **Stellar SDK:** [petad-chain](https://github.com/amina69/petad-stellar) - Blockchain SDK

---

**Made with 🐾 by the PetAd Team**

*Building trust infrastructure for pet adoption, one API at a time.*
