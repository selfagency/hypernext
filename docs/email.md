# Email & Newsletter

Hypernext includes an email system for newsletters, instant notifications, and contact forms.

## Configuration

```yaml
email:
  enabled: true
  transport: smtp
  from:
    name: "My Site"
    address: "noreply@example.com"
  replyTo: "hello@example.com"
  subjectPrefix: "[My Site]"
  smtp:
    host: "smtp.example.com"
    port: 587
    secure: false
    user: "your-user"
    pass: "your-pass"
  newsletter:
    digestSchedule: "0 8 * * 1"   # Every Monday at 8 AM
    digestTime: "08:00"
  contactForm:
    enabled: true
    recipient: "hello@example.com"
    captcha: true
    akismet: true
```

## Features

### Instant Notifications

When a new post is published, subscribers with `frequency: instant` receive an email notification immediately.

### Weekly Digest

Subscribers with `frequency: weekly` receive a digest of the week's posts.

### Contact Form

The contact form endpoint at `POST /api/v1/contact` accepts messages with optional CAPTCHA verification (via ribaunt) and Akismet spam filtering.

## API Endpoints

### Subscribe

```
POST /api/v1/subscribe
Content-Type: application/json

{"email": "user@example.com", "frequency": "instant"}
```

### Verify

```
GET /api/v1/subscribe/verify?token=...
```

### Unsubscribe

```
GET /api/v1/unsubscribe?token=...
```

### Contact Form

```
POST /api/v1/contact
Content-Type: application/json

{"name": "John", "email": "john@example.com", "message": "Hello!"}
```

## MCP Tools

- `list_subscribers` — List subscribers with optional frequency filter
- `add_subscriber` — Manually add a subscriber
- `delete_subscriber` — Remove a subscriber by email
- `send_test_email` — Send a test email to verify SMTP config
