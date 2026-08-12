//! HTTP client construction with SSRF, size, and redirect policy baked in.

use std::error::Error as _;
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use reqwest::redirect;
use reqwest::Client;
use tokio::io::{AsyncRead, ReadBuf};
use url::Url;

use crate::error::Error;
use crate::policy::{check_url, FetchPolicy};

/// Build a [`reqwest::Client`] whose redirect policy validates each hop with
/// `check_url` (SSRF + scheme + redirect limit). The client applies
/// `policy.timeout` to all requests.
///
/// reqwest 0.13 removed per-request redirect configuration, so the policy is
/// set at the `Client` level via `Policy::custom`.
pub fn build_client(policy: &FetchPolicy) -> Client {
    let max_redirects = policy.max_redirects;
    let hop_policy = policy.clone();

    let redirect_policy = redirect::Policy::custom(move |attempt| {
        // `previous().len()` counts every hop including the original request.
        // The limit is applied once the chain exceeds max_redirects.
        if attempt.previous().len() > max_redirects {
            return attempt.error(Error::RedirectLimit {
                limit: max_redirects,
            });
        }

        // Clone the next URL into an owned value so consuming `attempt` in the
        // returned action cannot conflict with a borrow of `attempt.url()`.
        let next = attempt.url().clone();
        match check_url(&next, &hop_policy) {
            Ok(()) => attempt.follow(),
            Err(_) => attempt.error(Error::RedirectRefused { url: next }),
        }
    });

    Client::builder()
        .redirect(redirect_policy)
        .timeout(policy.timeout)
        .build()
        .expect("reqwest client build should not fail with static builder config")
}

/// An [`AsyncRead`] wrapper that aborts once `limit` bytes have been read,
/// returning [`Error::SizeLimitExceeded`] as an `io::Error`. Streaming only —
/// it never buffers the whole body (avoids the ReadAll overflow bug).
///
/// Boundary semantics: reading exactly `limit` bytes then a clean EOF is
/// allowed; attempting to read further, while the underlying stream still has
/// data, fails with `SizeLimitExceeded`. EOF is detected with a discarded
/// 1-byte probe so an exactly-at-limit stream terminates normally.
pub struct BoundedReader<R> {
    inner: R,
    /// Bytes still allowed to be returned to the caller.
    remaining: u64,
    /// The configured limit, preserved for error reporting.
    limit: u64,
}

impl<R> BoundedReader<R> {
    /// Wrap `inner`, allowing at most `limit` bytes to be read.
    pub fn new(inner: R, limit: u64) -> Self {
        Self {
            inner,
            remaining: limit,
            limit,
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for BoundedReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if self.remaining == 0 {
            // We have already returned `limit` bytes. Probe the underlying
            // stream with a discarded 1-byte read to distinguish "exactly at
            // limit, clean EOF" from "limit exceeded".
            let mut probe = [0u8; 1];
            let mut probe_in = ReadBuf::new(&mut probe);
            return match Pin::new(&mut self.inner).poll_read(cx, &mut probe_in) {
                // Probe found no data: the stream is exhausted -> clean EOF.
                Poll::Ready(Ok(())) if probe_in.filled().is_empty() => Poll::Ready(Ok(())),
                // Probe found a byte: the stream continues past the limit.
                Poll::Ready(Ok(())) => Poll::Ready(Err(size_error(self.limit))),
                Poll::Pending => Poll::Pending,
                Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            };
        }

        // Clamp the read so we never admit more than `remaining` bytes.
        let limit = self.remaining.min(buf.remaining() as u64) as usize;
        let unfilled = buf.initialize_unfilled_to(limit);
        let mut sub = ReadBuf::new(unfilled);
        match Pin::new(&mut self.inner).poll_read(cx, &mut sub) {
            Poll::Ready(Ok(())) => {
                let n = sub.filled().len();
                self.remaining = self.remaining.saturating_sub(n as u64);
                buf.advance(n);
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

/// Fetch `url` with `client`, streaming the body and aborting once
/// `policy.max_response_size` is exceeded.
pub async fn fetch_body(
    client: &Client,
    url: &Url,
    policy: &FetchPolicy,
) -> Result<Vec<u8>, Error> {
    crate::policy::check_url(url, policy)?;

    let mut resp = client
        .get(url.clone())
        .send()
        .await
        .map_err(map_reqwest_error)?;

    let limit = policy.max_response_size;
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(map_reqwest_error)? {
        let new_len = buf.len().saturating_add(chunk.len());
        if new_len > limit as usize {
            return Err(Error::SizeLimitExceeded { limit });
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Map a `reqwest::Error` to our [`Error`], preserving redirect-policy errors
/// (SSRF at a hop, redirect limit) by downcasting the source chain.
pub(crate) fn map_reqwest_error(e: reqwest::Error) -> Error {
    if !e.is_redirect() {
        return Error::Network(e);
    }
    // Walk the source chain for our own policy error, preserving the variant.
    let mut src = e.source();
    while let Some(s) = src {
        if let Some(Error::RedirectLimit { limit }) = s.downcast_ref::<Error>() {
            return Error::RedirectLimit { limit: *limit };
        }
        if let Some(Error::RedirectRefused { url }) = s.downcast_ref::<Error>() {
            return Error::RedirectRefused { url: url.clone() };
        }
        if let Some(Error::SsrfBlocked { url, reason }) = s.downcast_ref::<Error>() {
            return Error::SsrfBlocked {
                url: url.clone(),
                reason: reason.clone(),
            };
        }
        src = s.source();
    }
    // Unreachable for clients built by `build_client` (the redirect closure
    // always surfaces our own `Error`), but keep the mapping total.
    Error::RedirectRefused {
        url: Url::parse("https://invalid.invalid").expect("static url is valid"),
    }
}

fn size_error(limit: u64) -> io::Error {
    io::Error::other(Error::SizeLimitExceeded { limit })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[tokio::test]
    async fn bounded_reader_under_limit_reads_all() {
        let data = b"hello world".to_vec();
        let mut reader = BoundedReader::new(Cursor::new(data.clone()), 100);
        let mut out = Vec::new();
        tokio::io::copy(&mut reader, &mut out).await.unwrap();
        assert_eq!(out, data);
    }

    #[tokio::test]
    async fn bounded_reader_exact_limit_ok() {
        let data = b"1234567890".to_vec();
        let mut reader = BoundedReader::new(Cursor::new(data.clone()), 10);
        let mut out = Vec::new();
        tokio::io::copy(&mut reader, &mut out).await.unwrap();
        assert_eq!(out, data);
    }

    #[tokio::test]
    async fn bounded_reader_over_limit_errors_size_limit() {
        let data = vec![0u8; 100];
        let mut reader = BoundedReader::new(Cursor::new(data), 10);
        let mut out = Vec::new();
        let err = tokio::io::copy(&mut reader, &mut out).await.unwrap_err();
        // Our SizeLimitExceeded is carried as an io::Error source.
        let downcast = err.get_ref().and_then(|e| e.downcast_ref::<Error>());
        match downcast {
            Some(Error::SizeLimitExceeded { limit }) => assert_eq!(*limit, 10),
            other => panic!("expected SizeLimitExceeded, got {other:?}"),
        }
        // Only the limit amount was read, never more.
        assert!(out.len() <= 10);
    }

    #[tokio::test]
    async fn bounded_reader_zero_limit_reads_nothing() {
        let data = vec![1u8; 5];
        let mut reader = BoundedReader::new(Cursor::new(data), 0);
        let mut out = Vec::new();
        let err = tokio::io::copy(&mut reader, &mut out).await.unwrap_err();
        assert!(err
            .get_ref()
            .and_then(|e| e.downcast_ref::<Error>())
            .is_some());
        assert!(out.is_empty());
    }
}
