# Deployment

Hypernext can be deployed using Docker Compose or run directly as a Node.js process.

## Docker Compose

Four variants are provided:

### Local Storage + Config

```yaml
# docker-compose.yml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./content:/app/content
      - ./config.yml:/app/config.yml
      - ./assets:/app/assets
      - ./hypernext.db:/app/hypernext.db
```

### S3 Storage + Config

```yaml
# docker-compose.s3.yml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
    volumes:
      - ./config.yml:/app/config.yml
```

### Local Storage + Environment Variables

```yaml
# docker-compose.env.yml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
    env_file: .env
    volumes:
      - ./content:/app/content
      - ./assets:/app/assets
```

### S3 Storage + Environment Variables

```yaml
# docker-compose.s3.env.yml
services:
  hypernext:
    build: .
    ports:
      - "8080:8080"
    env_file: .env
```

## Direct Node.js

```bash
# Development
pnpm dev

# Production build
pnpm build
pnpm start
```

## CLI Commands

```bash
hypernext                    # Start all protocol servers
hypernext push               # Push content to production
hypernext sync               # Two-way sync with production
hypernext ingest <url>       # Ingest a URL as MDX
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `HYPERNEXT_DB_PATH` | Database file path (default: `./hypernext.db`) |
| `HYPERNEXT_JWT_SECRET` | JWT signing secret |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |

## CI/CD

The project includes GitHub Actions CI (`.github/workflows/ci.yml`) that runs:
1. Linting (`pnpm check`)
2. Unit tests (`pnpm test:run`)
3. E2E tests (`pnpm test:e2e`)
4. Build (`pnpm build`)
