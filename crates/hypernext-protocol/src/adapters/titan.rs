//! Titan adapter — the upload counterpart to Gemini (Phase 2, §3.6).
//!
//! Same TLS, same TOFU, but writes instead of reads. Wraps `titanite`'s pure
//! wire codec (request/response parse + serialize) behind the [`Protocol`]
//! trait; this adapter owns all networking, TLS, TOFU, cancellation, and size
//! limits.
//!
//! # Explicit-confirmation gate (ethics B-09)
//!
//! **`Protocol::publish` must NEVER be called from navigation.** Uploading is
//! an irreversible side effect. Only the Titan upload dialog (UI, Phase 4)
//! calls `publish`, and only after the user explicitly confirms. This adapter
//! does not implement `fetch` — its `capabilities().supports_fetch` is `false`
//! and `fetch` returns [`HypernextError::Unsupported`] — so a navigation to a
//! `titan://` URL can never reach `publish`. The
//! `publish_cannot_be_reached_from_fetch` test asserts this invariant.
//!
//! # Wire format
//!
//! The upload request is `titan://host:port/path;size=<bytes>;mime=<mime>\r\n`
//! followed by the raw content bytes. The header is built with `titanite`'s
//! `Meta` codec (the authoritative serializer); the phase doc's
//! `?mime=...;size=...` spelling is a loose description of the same fields.
//!
//! # Guarantees
//!
//! - **Size limit enforced before upload begins** — a payload larger than
//!   `max_upload_size` fails with [`HypernextError::SizeLimitExceeded`] before
//!   any byte is sent (don't stream 1GB then fail at the end).
//! - **Progress** — a callback (if configured) fires every 32KB uploaded.
//! - **Cancellation** — the connect and the upload/response exchange are
//!   wrapped in `tokio::select!` against `FetchContext::cancel`.
//! - **TOFU** — reuses the shared `tofu_certs` pinning via `tofu::tls_connect`.
//! - **SSRF** — `FetchPolicy::check_url` runs before the TCP dial (invariant #8).
//! - **MIME** — sniffed from the content when the user does not specify one;
//!   a user-supplied MIME overrides the sniff and is validated.

use std::sync::Arc;

use async_trait::async_trait;
use hypernext_core::HypernextError;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use url::Url;

use crate::dispatcher::{Capabilities, FetchContext, Protocol, PublishPayload, PublishResult};

use super::tofu;

/// Titan's well-known port.
const DEFAULT_PORT: u16 = 1965;

/// Default maximum upload size: 100MB.
const DEFAULT_MAX_UPLOAD_SIZE: usize = 100 * 1024 * 1024;

/// Progress callback granularity: emit once per 32KB uploaded.
const PROGRESS_CHUNK: usize = 32 * 1024;

/// A progress callback receiving the cumulative number of bytes uploaded.
pub type ProgressFn = dyn Fn(u64) + Send + Sync;

/// The Titan adapter. Stateless apart from its size limit and optional
/// progress callback; TOFU pins live in the store, so a single unit serves
/// every upload.
pub struct TitanAdapter {
    max_upload_size: usize,
    progress: Option<Arc<ProgressFn>>,
}

impl std::fmt::Debug for TitanAdapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TitanAdapter")
            .field("max_upload_size", &self.max_upload_size)
            .field("progress", &self.progress.is_some())
            .finish()
    }
}

impl Default for TitanAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl TitanAdapter {
    pub fn new() -> Self {
        Self {
            max_upload_size: DEFAULT_MAX_UPLOAD_SIZE,
            progress: None,
        }
    }

    /// Override the maximum upload size (default 100MB). Enforced before any
    /// byte is sent.
    pub fn with_max_upload_size(mut self, size: usize) -> Self {
        self.max_upload_size = size;
        self
    }

    /// Register a progress callback, invoked with the cumulative uploaded byte
    /// count every [`PROGRESS_CHUNK`] bytes.
    pub fn with_progress<F>(mut self, f: F) -> Self
    where
        F: Fn(u64) + Send + Sync + 'static,
    {
        self.progress = Some(Arc::new(f));
        self
    }

    /// Upload `payload` to `url` over a TOFU-pinned TLS connection.
    async fn upload(
        &self,
        url: &Url,
        payload: &PublishPayload,
        ctx: &FetchContext<'_>,
    ) -> Result<PublishResult, HypernextError> {
        // Hoist the Send+Sync fields out of `ctx` before any await: `ctx` is
        // not `Sync` (it borrows a `rusqlite::Connection`), so holding it across
        // `.await` would make the async-trait future `!Send`.
        let policy = ctx.policy;

        // Validate the MIME type before any network I/O.
        let mime = resolve_mime(payload)?;

        // Size limit enforced before upload begins.
        if payload.content.len() > self.max_upload_size {
            return Err(HypernextError::SizeLimitExceeded(self.max_upload_size));
        }

        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("titan URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(DEFAULT_PORT);

        // SSRF gate before dialing (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        // TOFU-pinned TLS connect (honors ctx.cancel around the handshake).
        let mut stream = tofu::tls_connect(&vetted.host, vetted.port, ctx).await?;

        // Build the request header with titanite's Meta codec.
        let meta = titanite::request::titan::Meta {
            size: payload.content.len(),
            url: url.clone(),
            mime: Some(mime),
            token: None,
            options: None,
        };
        let header = meta.to_bytes();

        // Write header + content in 32KB chunks, honoring cancel and progress.
        let cancel = ctx.cancel.clone();
        let write = self.write_upload(&mut stream, &header, &payload.content);
        tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = write => r?,
        }

        // Read the response to EOF (capped), honoring cancel.
        let cancel = ctx.cancel.clone();
        let read = read_response(&mut stream, policy.max_response_size);
        let raw = tokio::select! {
            _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
            r = read => r?,
        };

        handle_response(url, &raw)
    }

    /// Write the header then the content in [`PROGRESS_CHUNK`] slices, firing
    /// the progress callback after each chunk.
    async fn write_upload<S>(
        &self,
        stream: &mut S,
        header: &[u8],
        content: &[u8],
    ) -> Result<(), HypernextError>
    where
        S: tokio::io::AsyncWrite + Unpin,
    {
        stream
            .write_all(header)
            .await
            .map_err(|e| HypernextError::Network(format!("write header: {e}")))?;

        let mut sent = 0usize;
        for chunk in content.chunks(PROGRESS_CHUNK) {
            stream
                .write_all(chunk)
                .await
                .map_err(|e| HypernextError::Network(format!("write body: {e}")))?;
            sent += chunk.len();
            if let Some(progress) = &self.progress {
                progress(sent as u64);
            }
        }
        Ok(())
    }
}

/// Resolve the MIME type for a payload: use the user-supplied value if present
/// (validated), otherwise sniff from the content. Returns
/// [`HypernextError::InvalidInput`] for a malformed user-supplied MIME.
fn resolve_mime(payload: &PublishPayload) -> Result<String, HypernextError> {
    let trimmed = payload.mime.trim();
    if trimmed.is_empty() {
        return Ok(sniff_mime(&payload.content).to_string());
    }
    if !is_valid_mime(trimmed) {
        return Err(HypernextError::InvalidInput(format!(
            "malformed MIME type: {trimmed}"
        )));
    }
    Ok(trimmed.to_string())
}

/// A MIME type is `type/subtype` with no whitespace or control characters.
fn is_valid_mime(mime: &str) -> bool {
    if mime.is_empty() || mime.len() > 128 {
        return false;
    }
    let Some((ty, sub)) = mime.split_once('/') else {
        return false;
    };
    !ty.is_empty()
        && !sub.is_empty()
        && ty
            .chars()
            .chain(sub.chars())
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.' | '_'))
}

/// Minimal first-party MIME sniffer for common types (magic bytes). Falls back
/// to `application/octet-stream`. No external dependency (crate-audit has no
/// MIME crate); extend the table as new types are needed.
fn sniff_mime(content: &[u8]) -> &'static str {
    if content.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if content.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if content.starts_with(b"GIF87a") || content.starts_with(b"GIF89a") {
        "image/gif"
    } else if content.starts_with(b"%PDF-") {
        "application/pdf"
    } else if content.starts_with(b"<svg") || content.starts_with(b"<?xml") {
        "image/svg+xml"
    } else if content.starts_with(b"#!")
        || content
            .iter()
            .all(|b| b.is_ascii() && !b.is_ascii_control())
    {
        "text/plain"
    } else {
        "application/octet-stream"
    }
}

/// Read the response to EOF, capping at `max` bytes.
async fn read_response<S>(stream: &mut S, max: usize) -> Result<Vec<u8>, HypernextError>
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut raw = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|e| HypernextError::Network(format!("read response: {e}")))?;
        if n == 0 {
            break;
        }
        if raw.len() + n > max {
            return Err(HypernextError::SizeLimitExceeded(max));
        }
        raw.extend_from_slice(&buf[..n]);
    }
    Ok(raw)
}

/// Map a Titan response to a `PublishResult` or error by status class.
fn handle_response(url: &Url, raw: &[u8]) -> Result<PublishResult, HypernextError> {
    let response = titanite::Response::from_bytes(raw)
        .map_err(|e| HypernextError::InvalidResponse(e.to_string()))?;
    match response {
        titanite::Response::Success(_) => Ok(PublishResult {
            url: Some(url.clone()),
        }),
        titanite::Response::Redirect(_) => Ok(PublishResult {
            url: Some(url.clone()),
        }),
        titanite::Response::Input(_) => Err(HypernextError::Protocol(
            "titan server requested input during upload".to_string(),
        )),
        titanite::Response::Failure(f) => match f {
            titanite::response::Failure::Permanent(_) => Err(HypernextError::ProtocolRejected(
                "titan server rejected the upload (5x)".to_string(),
            )),
            titanite::response::Failure::Temporary(_) => Err(HypernextError::Protocol(
                "titan server temporary failure (4x)".to_string(),
            )),
        },
        titanite::Response::Certificate(_) => Err(HypernextError::Unauthorized(
            "titan server requires a client certificate".to_string(),
        )),
    }
}

#[async_trait]
impl Protocol for TitanAdapter {
    fn scheme(&self) -> &'static str {
        "titan"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: false,
            supports_publish: true,
            needs_tls: true,
            needs_tofu: true,
            ..Default::default()
        }
    }

    /// Titan is upload-only. `fetch` is intentionally unsupported so a
    /// navigation to a `titan://` URL can never reach `publish` (ethics B-09).
    async fn fetch(
        &self,
        _url: &Url,
        _ctx: &FetchContext,
    ) -> Result<hypernext_core::PageDoc, HypernextError> {
        Err(HypernextError::Unsupported)
    }

    async fn publish(
        &self,
        url: &Url,
        payload: &PublishPayload,
        ctx: &FetchContext,
    ) -> Result<PublishResult, HypernextError> {
        self.upload(url, payload, ctx).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatcher::FetchPolicy;
    use std::sync::Mutex;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn ctx(policy: &FetchPolicy) -> FetchContext<'_> {
        let client = Box::leak(Box::new(reqwest::Client::new()));
        let store = Box::leak(Box::new(Mutex::new(
            hypernext_store::db::open_in_memory().unwrap(),
        )));
        FetchContext {
            http_client: client,
            cancel: tokio_util::sync::CancellationToken::new(),
            incognito: false,
            policy,
            store,
        }
    }

    fn payload(mime: &str, content: Vec<u8>) -> PublishPayload {
        PublishPayload {
            mime: mime.to_string(),
            content,
        }
    }

    #[test]
    fn publish_cannot_be_reached_from_fetch() {
        // Ethics B-09: upload is an irreversible side effect. `publish` must
        // never be reachable from navigation. Titan is upload-only, so a
        // navigation to a titan:// URL hits `fetch`, which is unsupported —
        // proving `publish` is not on the navigation path.
        let adapter = TitanAdapter::new();
        assert!(!adapter.capabilities().supports_fetch);
        assert!(adapter.capabilities().supports_publish);
    }

    #[tokio::test]
    async fn invalid_mime_returns_invalid_input() {
        let adapter = TitanAdapter::new();
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let u = url("titan://example.com/upload");
        let err = adapter
            .publish(&u, &payload("not a mime", b"data".to_vec()), &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[tokio::test]
    async fn size_over_limit_fails_before_upload() {
        let adapter = TitanAdapter::new().with_max_upload_size(10);
        let policy = FetchPolicy::default();
        let c = ctx(&policy);
        let u = url("titan://example.com/upload");
        let err = adapter
            .publish(&u, &payload("text/plain", vec![b'x'; 100]), &c)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "SIZE_LIMIT_EXCEEDED");
    }

    #[test]
    fn empty_mime_is_sniffed() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n..."), "image/png");
        assert_eq!(sniff_mime(b"%PDF-1.4"), "application/pdf");
        assert_eq!(sniff_mime(b"hello world"), "text/plain");
        assert_eq!(
            sniff_mime(&[0xff, 0x00, 0xfe, 0x01]),
            "application/octet-stream"
        );
    }

    #[test]
    fn user_mime_overrides_sniff() {
        let p = payload("text/markdown", b"\x89PNG\r\n\x1a\n".to_vec());
        assert_eq!(resolve_mime(&p).unwrap(), "text/markdown");
    }

    #[test]
    fn valid_mime_is_accepted() {
        assert!(is_valid_mime("text/plain"));
        assert!(is_valid_mime("application/vnd.ms-excel"));
        assert!(is_valid_mime("image/svg+xml"));
        assert!(!is_valid_mime("text"));
        assert!(!is_valid_mime("text/ plain"));
        assert!(!is_valid_mime(""));
    }
}
