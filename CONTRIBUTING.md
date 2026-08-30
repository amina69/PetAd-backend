# Contributing to PetAd Backend 🐾

Thanks for your interest in contributing! Here's how to get started.

---

## 🚀 Quick Start

1. **Fork the repository**
2. **Clone your fork:**
   ```bash
   git clone https://github.com/amina69/PetAd-Backend.git
   cd PetAd-Backend
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Setup environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```
5. **Start services:**
   ```bash
   docker-compose up -d
   npx prisma migrate dev
   npm run start:dev
   ```

---

## 📝 Branch Naming

- `feature/add-pagination` - New features
- `fix/escrow-timeout` - Bug fixes
- `docs/update-readme` - Documentation
- `refactor/auth-service` - Code refactoring
- `test/adoption-e2e` - Tests

---

## 💻 Code Style

- Use TypeScript strict mode
- Follow ESLint rules (`npm run lint`)
- Format code with Prettier (`npm run format`)
- Keep functions small and focused
- Use dependency injection
- Write meaningful variable names

---

## ✅ Commit Messages

Follow Conventional Commits:

```bash
feat(pets): add search functionality
fix(auth): handle expired tokens
docs(readme): update setup instructions
test(adoption): add unit tests
refactor(escrow): simplify transaction logic
```

---

## 🔀 Pull Request Process

1. **Create a branch** from `main`
2. **Make your changes**
3. **Run tests:** `npm test`
4. **Lint code:** `npm run lint`
5. **Commit** following conventional commits
6. **Push** to your fork
7. **Open a PR** to `main` branch
8. **Link related issue**
9. **Example:** Closes #12



Fill out the PR template completely


### PR Checklist

- [ ] Tests pass
- [ ] Code linted
- [ ] Documentation updated (if needed)
- [ ] Follows code style guidelines

---

## 🧪 Testing

```bash
npm test              # Run tests
npm run test:cov      # Coverage report
npm run test:e2e      # E2E tests
```

**Minimum coverage:** 80% for new code

---
## 🐛 Reporting Issues

- Use issue templates
- Provide clear reproduction steps
- Include environment details
---

**Happy coding! 🐾**
