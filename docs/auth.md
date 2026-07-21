# Authentication

Hypernext uses **IndieAuth** (OAuth 2.0) for API authentication. All requests to `/api/v1/*` require a valid JWT bearer token.

## Quick Start: Generate an API Token

```bash
# Generate a long-lived token for use in config.yml
hypernext token

# Custom expiry and scope
hypernext token --name "prod-sync" --expires 30 --scope "create,update"
```

This creates a JWT valid for 365 days with full API access. Add it to your production server's `config.yml`:

```yaml
remote:
  enabled: true
  url: "https://your-server.com"
  token: "<token from hypernext token>"
```

Now use `hypernext push` and `hypernext sync` to publish content.

## IndieAuth OAuth Flow

For interactive applications (like Micropub clients), use the full OAuth 2.0 flow:

### 1. Authorization Server Metadata

```
GET /.well-known/oauth-authorization-server
```

Returns the authorization server configuration including endpoints and supported scopes.

### 2. Authorization Request

```
GET /auth/authorize?client_id=<url>&redirect_uri=<url>&state=<string>
```

The user is redirected to this URL to authorize access. On success, they're redirected back with an authorization code.

### 3. Token Exchange

```
POST /auth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "<code from step 2>",
  "redirect_uri": "<same redirect_uri>",
  "client_id": "<same client_id>"
}
```

Returns a JWT access token (valid 1 hour) and a refresh token.

### 4. Use the Token

```
GET /api/v1/docs
Authorization: Bearer <jwt>
```

## API Endpoints

All API endpoints require authentication via `Authorization: Bearer <token>`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/docs` | List documents |
| `GET` | `/api/v1/docs/:slug` | Get document JSON |
| `PUT` | `/api/v1/docs/:slug` | Create or update document |
| `POST` | `/api/v1/ingest` | Ingest a URL as MDX |
| `GET` | `/api/v1/stats` | Site statistics |
| `GET` | `/api/v1/comments` | Moderation queue |
| `GET` | `/api/v1/subscribers` | Newsletter subscribers |

## Scopes

| Scope | Permission |
|-------|-----------|
| `create` | Create new documents |
| `update` | Update existing documents |
| `delete` | Delete documents |
| `media` | Upload media files |
| `upload` | Upload files |

## Configuration

```yaml
indieauth:
  enabled: true       # Enable IndieAuth (default: true)
```

```yaml
jwtSecret: "your-secret"  # Override JWT signing secret (optional, auto-generated)
```

If no `jwtSecret` is configured, Hypernext uses a default development secret. **Set a custom secret in production.**

## Use with `hypernext push` / `hypernext sync`

1. On the **production server**: Generate a token:
   ```bash
   hypernext token --name "deploy-token" --expires 365
   ```

2. On the **local machine**: Add to `config.yml`:
   ```yaml
   remote:
     enabled: true
     url: "https://your-server.com"
     token: "<the generated token>"
   ```

3. Push content:
   ```bash
   hypernext push
   ```

## Disabling Authentication

To disable the IndieAuth endpoints, set `indieauth.enabled: false` in `config.yml`. Note that API endpoints will still require authentication unless the API auth guard is also configured.

## Security Notes

- JWT tokens are signed with the server's `jwtSecret`
- In production, always set a custom `jwtSecret` in `config.yml`
- Token expiry should be set appropriately for your use case
- The `hypernext token` command creates tokens valid for 1 year by default
- For automated deployments, consider shorter-lived tokens rotated via CI/CD
