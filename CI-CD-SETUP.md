# CI/CD Pipeline Setup

This document explains the CI/CD pipeline implemented for the PetAd-backend project using GitHub Actions.

## 🚀 Pipeline Overview

The CI/CD pipeline is designed to automate testing, building, and deployment processes with the following key features:

- **Automated triggers** on push/PR to main branch
- **Comprehensive testing** (unit, integration, e2e)
- **Security scanning** and vulnerability checks
- **Multi-environment deployment** (staging/production)
- **Clear error reporting** and notifications

## 📋 Pipeline Stages

### 1. Test & Lint
- **Linting**: Code quality checks using ESLint
- **Unit Tests**: Jest-based unit tests with coverage
- **E2E Tests**: End-to-end testing
- **Database Setup**: PostgreSQL and Redis services
- **Prisma Operations**: Client generation and migrations

### 2. Build Application
- **Compilation**: TypeScript to JavaScript
- **Artifact Upload**: Build artifacts stored for deployment

### 3. Security Scan
- **NPM Audit**: Dependency vulnerability scanning
- **Snyk Scan**: Advanced security analysis (optional)

### 4. Deploy Staging
- **Trigger**: Push to `develop` branch
- **Environment**: Staging deployment
- **Health Checks**: Post-deployment verification

### 5. Deploy Production
- **Trigger**: Push to `main` branch
- **Environment**: Production deployment
- **Health Checks**: Post-deployment verification

### 6. Notify Results
- **Success Notifications**: Pipeline completion alerts
- **Failure Notifications**: Error reporting and debugging info

## 🔧 Required GitHub Secrets

To use this pipeline effectively, you need to configure the following secrets in your GitHub repository:

### Required Secrets

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `DATABASE_URL` | Production database connection string | `postgresql://user:pass@host:5432/dbname` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | `your-super-secure-jwt-secret-min-32-characters` |
| `STELLAR_SECRET_KEY` | Stellar blockchain secret key | `S...` |
| `STELLAR_PUBLIC_KEY` | Stellar blockchain public key | `G...` |
| `STELLAR_HORIZON_URL` | Stellar Horizon API URL | `https://horizon-testnet.stellar.org` |

### Optional Secrets

| Secret Name | Description | Purpose |
|-------------|-------------|---------|
| `SNYK_TOKEN` | Snyk security scanning token | Advanced vulnerability scanning |
| `SENTRY_DSN` | Sentry error tracking DSN | Production error monitoring |
| `SMTP_HOST` | Email server host | Email notifications |
| `SMTP_USER` | Email server username | Email authentication |
| `SMTP_PASS` | Email server password | Email authentication |

### Environment-Specific Secrets

For staging and production environments, you can prefix secrets with the environment name:

- `STAGING_DATABASE_URL`
- `PRODUCTION_DATABASE_URL`
- `STAGING_REDIS_URL`
- `PRODUCTION_REDIS_URL`

## 🛠️ Setup Instructions

### 1. Configure GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each required secret from the table above

### 2. Set Up Environments

1. Go to **Settings** → **Environments**
2. Create `staging` environment
3. Create `production` environment
4. Configure protection rules as needed

### 3. Configure Deployment (Optional)

The pipeline includes placeholder deployment steps. To implement actual deployment:

#### Docker Deployment Example
```yaml
- name: Build and push Docker image
  run: |
    docker build -t petad-backend:${{ github.sha }} .
    docker tag petad-backend:${{ github.sha }} your-registry/petad-backend:latest
    docker push your-registry/petad-backend:latest
```

#### SSH Deployment Example
```yaml
- name: Deploy via SSH
  uses: appleboy/ssh-action@v0.1.5
  with:
    host: ${{ secrets.HOST }}
    username: ${{ secrets.USERNAME }}
    key: ${{ secrets.SSH_KEY }}
    script: |
      cd /path/to/app
      docker-compose pull
      docker-compose up -d
```

## 📊 Pipeline Triggers

The pipeline automatically runs on:

- **Push to `main` branch**: Full pipeline including production deployment
- **Push to `develop` branch**: Full pipeline including staging deployment
- **Pull Request to `main`**: Testing and build only (no deployment)

## 🔍 Monitoring and Debugging

### Viewing Pipeline Results

1. Go to **Actions** tab in your GitHub repository
2. Click on the workflow run
3. View detailed logs for each job
4. Check artifacts and test results

### Common Issues and Solutions

#### Test Failures
- Check database connection strings
- Verify Redis connectivity
- Review test logs for specific errors

#### Build Failures
- Ensure all dependencies are installed
- Check TypeScript compilation errors
- Verify Prisma schema is valid

#### Deployment Failures
- Verify environment secrets are correct
- Check deployment target accessibility
- Review deployment logs for specific errors

## 🚦 Pipeline Status Indicators

- ✅ **Green**: All stages completed successfully
- ❌ **Red**: Pipeline failed - check logs for details
- 🟡 **Yellow**: Pipeline in progress
- ⚪ **White**: Pipeline skipped (conditions not met)

## 📈 Best Practices

1. **Keep secrets secure**: Never commit sensitive data to repository
2. **Monitor pipeline performance**: Regular check execution times
3. **Update dependencies**: Keep GitHub Actions versions current
4. **Test thoroughly**: Ensure comprehensive test coverage
5. **Document changes**: Update this README when modifying pipeline

## 🆘 Troubleshooting

### Pipeline Not Running
- Check workflow file syntax (`.github/workflows/ci-cd.yml`)
- Verify branch names match triggers
- Ensure GitHub Actions is enabled for repository

### Tests Failing Intermittently
- Add retry logic for flaky tests
- Check resource constraints
- Review test isolation

### Deployment Issues
- Verify target environment configuration
- Check network connectivity
- Review deployment credentials

## 📞 Support

For issues with the CI/CD pipeline:

1. Check this documentation first
2. Review GitHub Actions logs
3. Consult the [GitHub Actions documentation](https://docs.github.com/en/actions)
4. Create an issue in the repository with detailed error information

---

**Last Updated**: February 2026
**Pipeline Version**: 1.0.0
