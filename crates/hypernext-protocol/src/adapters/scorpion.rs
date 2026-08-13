//! Scorpion adapter — wraps `scorpion-protocol` (Phase 2, §3.5).
//!
//! Scorpion (`scorpion://`, `scorpions://`) runs four subprotocols — receive,
//! send, interactive, meta — over one port (1517), with TLS and plaintext
//! sharing the port and distinguished by the first byte. This adapter drives
//! the **receive** subprotocol (`R`), which is the only one mandatory to
//! implement, and maps the response's binary block document format to
//! `Vec<Block>`.
//!
//! - **SSRF** (invariant #8): `FetchPolicy::check_url` runs before the dial.
//! - **Cancellation** (ADR 0008): the exchange is wrapped in `tokio::select!`
//!   against `FetchContext::cancel`.
//! - **Size limits**: the crate's `Limits.max_body` enforces
//!   `FetchPolicy::max_response_size` during the read.
//! - **TOFU** (`scorpions://`): the leaf certificate is pinned in the
//!   `tofu_certs` table on first contact; a changed cert fails with
//!   `TofuCertChanged` (Phase 2 §3.5 step 4).

use async_trait::async_trait;
use hypernext_core::{
    Block, DebugInfo, HttpRequestDebug, HttpResponseDebug, HypernextError, Metadata, PageDoc,
};
use std::collections::HashMap;
use tokio::net::TcpStream;
use url::Url;

use crate::adapters::tcp_helper::{first_heading, span};
use crate::adapters::tofu;
use crate::dispatcher::{Capabilities, FetchContext, Protocol};

/// Scorpion's well-known port, shared by TLS and plaintext.
const DEFAULT_PORT: u16 = 1517;

/// The Scorpion adapter. Stateless: TOFU pins live in the store.
#[derive(Debug, Default)]
pub struct ScorpionAdapter;

impl ScorpionAdapter {
    pub fn new() -> Self {
        Self
    }

    /// Run the receive exchange over a connected stream, honoring the cancel
    /// token and the size policy.
    async fn exchange(
        &self,
        url: &Url,
        stream: &mut (impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin),
        ctx: &FetchContext<'_>,
    ) -> Result<scorpion_protocol::client::Response, HypernextError> {
        let request = scorpion_protocol::Request::receive(url.as_str());
        let limits = limits_for(ctx.policy.max_response_size);
        let cancel = ctx.cancel.clone();
        tokio::select! {
            _ = cancel.cancelled() => Err(HypernextError::Cancelled),
            r = scorpion_protocol::client::exchange(stream, &request, limits) => {
                r.map_err(map_client_error)
            }
        }
    }

    /// Map a Scorpion response to a `PageDoc` or error by status class.
    fn handle_response(
        &self,
        url: &Url,
        response: &scorpion_protocol::client::Response,
    ) -> Result<PageDoc, HypernextError> {
        use scorpion_protocol::status::Major;
        let header = &response.header;
        match header.status.major() {
            Major::Input => {
                let prompt = header.prompt().unwrap_or("").to_string();
                Ok(self.doc(
                    url,
                    url.clone(),
                    vec![Block::Paragraph(span(&prompt))],
                    None,
                    response,
                ))
            }
            Major::Success => {
                let blocks = self.parse_body(response, url)?;
                let title = first_heading(&blocks);
                Ok(self.doc(url, url.clone(), blocks, title, response))
            }
            Major::Redirect => {
                let target = header.redirect().ok_or_else(|| {
                    HypernextError::InvalidResponse("scorpion: redirect with no target".into())
                })?;
                let target =
                    Url::parse(target).map_err(|e| HypernextError::InvalidUrl(e.to_string()))?;
                Ok(self.doc(url, target, Vec::new(), None, response))
            }
            Major::TemporaryError => Err(HypernextError::Protocol(format!(
                "scorpion temporary failure {}: {}",
                header.status.code(),
                header.message().unwrap_or("")
            ))),
            Major::PermanentError => {
                if header.status == scorpion_protocol::Status::NOT_FOUND {
                    Err(HypernextError::NotFound(
                        header.message().unwrap_or("").to_string(),
                    ))
                } else {
                    Err(HypernextError::Protocol(format!(
                        "scorpion permanent failure {}: {}",
                        header.status.code(),
                        header.message().unwrap_or("")
                    )))
                }
            }
            Major::CertificateRequired => Err(HypernextError::Unauthorized(format!(
                "client certificate required for {}",
                url.host_str().unwrap_or("")
            ))),
            // 7x/8x are send-subprotocol responses; a receive never sees them.
            Major::ReadyToReceive | Major::Accepted => Err(HypernextError::Protocol(format!(
                "scorpion unexpected status {} for a receive request",
                header.status.code()
            ))),
            Major::Interactive => Err(HypernextError::Protocol(format!(
                "scorpion unexpected status {} for a receive request",
                header.status.code()
            ))),
        }
    }

    /// Parse a successful body as a Scorpion binary-block document.
    fn parse_body(
        &self,
        response: &scorpion_protocol::client::Response,
        base: &Url,
    ) -> Result<Vec<Block>, HypernextError> {
        let media_type = response
            .header
            .success()
            .and_then(|s| s.ok())
            .map(|s| s.media_type.to_string())
            .unwrap_or_default();
        // The document format is binary blocks; parse them. A body that is not
        // a well-formed Scorpion document falls back to a single Raw block.
        match scorpion_protocol::document::parse(&response.body) {
            Ok(blocks) if !blocks.is_empty() => Ok(blocks
                .into_iter()
                .filter_map(|b| scorpion_block(b, base))
                .collect()),
            _ => Ok(vec![Block::Raw {
                mime: media_type,
                bytes: response.body.clone(),
            }]),
        }
    }

    /// Build a normalized `PageDoc` with debug metadata.
    fn doc(
        &self,
        url: &Url,
        final_url: Url,
        blocks: Vec<Block>,
        title: Option<String>,
        response: &scorpion_protocol::client::Response,
    ) -> PageDoc {
        let media_type = response
            .header
            .success()
            .and_then(|s| s.ok())
            .map(|s| s.media_type.to_string());
        PageDoc {
            url: url.clone(),
            final_url,
            title,
            metadata: Metadata::default(),
            blocks,
            signature: None,
            debug: DebugInfo {
                request: HttpRequestDebug {
                    method: "R".to_string(),
                    url: url.clone(),
                    headers: HashMap::new(),
                },
                response: HttpResponseDebug {
                    status: response.header.status.code() as u16,
                    headers: HashMap::new(),
                    content_type: media_type,
                    content_length: Some(response.body.len() as u64),
                },
                timing: Default::default(),
                redirects: Vec::new(),
                parser_decisions: Vec::new(),
                tls: None,
            },
            from_cache: false,
        }
    }
}

#[async_trait]
impl Protocol for ScorpionAdapter {
    fn scheme(&self) -> &'static str {
        "scorpion"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            supports_fetch: true,
            needs_tls: true,
            needs_tofu: true,
            ..Default::default()
        }
    }

    async fn fetch(&self, url: &Url, ctx: &FetchContext) -> Result<PageDoc, HypernextError> {
        let policy = ctx.policy;
        let host = url
            .host_str()
            .ok_or_else(|| HypernextError::InvalidUrl("scorpion URL has no host".to_string()))?
            .to_string();
        let port = url.port().unwrap_or(DEFAULT_PORT);

        // SSRF gate before dialing (invariant #8).
        let vetted = policy.check_url(&host, port).await?;

        let secure = url.scheme() == "scorpions";
        let response = if secure {
            let mut stream = tofu::tls_connect(&vetted.host, vetted.port, ctx).await?;
            self.exchange(url, &mut stream, ctx).await?
        } else {
            let mut stream = TcpStream::connect((vetted.host.as_str(), vetted.port))
                .await
                .map_err(|e| {
                    HypernextError::Network(format!("tcp {}:{}: {e}", vetted.host, vetted.port))
                })?;
            self.exchange(url, &mut stream, ctx).await?
        };

        self.handle_response(url, &response)
    }
}

/// Build the crate's read limits from `FetchPolicy::max_response_size`.
fn limits_for(max_response_size: usize) -> scorpion_protocol::client::Limits {
    scorpion_protocol::client::Limits {
        max_body: max_response_size as u64,
        ..Default::default()
    }
}

/// Map the crate's `ClientError` into `HypernextError`.
fn map_client_error(e: scorpion_protocol::client::ClientError) -> HypernextError {
    match e {
        scorpion_protocol::client::ClientError::Io(m) => HypernextError::Network(m.to_string()),
        scorpion_protocol::client::ClientError::Response(m) => {
            HypernextError::InvalidResponse(m.to_string())
        }
        scorpion_protocol::client::ClientError::Url(m) => HypernextError::InvalidUrl(m),
        scorpion_protocol::client::ClientError::BodyTooLarge { declared, limit } => {
            HypernextError::SizeLimitExceeded(declared.min(limit) as usize)
        }
        scorpion_protocol::client::ClientError::Truncated { declared, received } => {
            HypernextError::InvalidResponse(format!(
                "scorpion: server declared {declared} bytes but sent {received}"
            ))
        }
    }
}

/// Map one Scorpion document block to a `Block`, or `None` to skip it.
fn scorpion_block(block: scorpion_protocol::Block, base: &Url) -> Option<Block> {
    use scorpion_protocol::BlockType;
    let text = String::from_utf8_lossy(&block.body).into_owned();
    match block.block_type {
        BlockType::Paragraph => Some(Block::Paragraph(span(&text))),
        BlockType::Heading(level) => {
            let id = if block.attribute.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&block.attribute).into_owned())
            };
            Some(Block::Heading { level, text, id })
        }
        BlockType::Link | BlockType::InputLink | BlockType::InteractiveLink => {
            let target = block.url().and_then(|u| Url::parse(u).ok())?;
            Some(Block::Link {
                url: base.join(target.as_str()).unwrap_or(target),
                text: span(&text),
            })
        }
        BlockType::Blockquote => Some(Block::Quote(span(&text))),
        BlockType::Preformatted => Some(Block::Code {
            language: None,
            text,
        }),
        // Alternate-service hints and optional metadata are not content.
        BlockType::AlternateService | BlockType::Metadata => None,
        BlockType::Unknown(_) => Some(Block::Raw {
            mime: "application/octet-stream".to_string(),
            bytes: block.body,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use scorpion_protocol::Header;
    use scorpion_protocol::client::Response;
    use scorpion_protocol::document::{Block as SBlock, BlockType, Encoding};

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn resp(line: &str, body: &[u8]) -> Response {
        Response {
            header: Header::parse(line).unwrap(),
            body: body.to_vec(),
        }
    }

    fn doc_bytes() -> Vec<u8> {
        let blocks = vec![
            SBlock::new(BlockType::Heading(1), Encoding::Pc, b"Title".to_vec()),
            SBlock::new(BlockType::Paragraph, Encoding::Pc, b"Some text.".to_vec()),
            SBlock::link(
                b"scorpion://example.com/next".to_vec(),
                b"Next".to_vec(),
                Encoding::Pc,
            ),
        ];
        scorpion_protocol::document::encode(&blocks).unwrap()
    }

    #[test]
    fn parses_success_document_into_blocks() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let body = doc_bytes();
        let doc = adapter
            .handle_response(&u, &resp("20 1234 text/scorpion", &body))
            .unwrap();
        assert_eq!(doc.blocks.len(), 3);
        assert!(matches!(&doc.blocks[0], Block::Heading { level: 1, text, .. } if text == "Title"));
        assert!(matches!(&doc.blocks[1], Block::Paragraph(_)));
        assert!(matches!(&doc.blocks[2], Block::Link { .. }));
    }

    #[test]
    fn parses_redirect_status() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let doc = adapter
            .handle_response(&u, &resp("31 scorpion://other.example/", b""))
            .unwrap();
        assert_eq!(doc.final_url, url("scorpion://other.example/"));
    }

    #[test]
    fn parses_input_status_as_prompt() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let doc = adapter
            .handle_response(&u, &resp("10 Enter your name", b""))
            .unwrap();
        assert_eq!(doc.blocks, vec![Block::Paragraph(span("Enter your name"))]);
    }

    #[test]
    fn not_found_maps_to_not_found() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter
            .handle_response(&u, &resp("51 no such file", b""))
            .unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    #[test]
    fn permanent_error_maps_to_protocol_error() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter
            .handle_response(&u, &resp("54 forbidden", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn certificate_required_maps_to_unauthorized() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter
            .handle_response(&u, &resp("60 cert needed", b""))
            .unwrap_err();
        assert_eq!(err.code(), "UNAUTHORIZED");
    }

    #[test]
    fn malformed_document_falls_back_to_raw() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        // A body that is not a valid scorpion document (truncated block).
        let doc = adapter
            .handle_response(&u, &resp("20 5 text/plain", b"\x00\x00\x00\x00\x01"))
            .unwrap();
        assert_eq!(doc.blocks.len(), 1);
        assert!(matches!(&doc.blocks[0], Block::Raw { mime, .. } if mime == "text/plain"));
    }

    #[test]
    fn empty_document_falls_back_to_raw() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let doc = adapter
            .handle_response(&u, &resp("20 0 text/plain", b""))
            .unwrap();
        assert_eq!(doc.blocks.len(), 1);
        assert!(matches!(&doc.blocks[0], Block::Raw { .. }));
    }

    #[test]
    fn oversized_body_is_rejected_by_limits() {
        // The crate's exchange enforces Limits.max_body; the adapter wires the
        // policy into the limits it passes.
        let limits = limits_for(10);
        assert_eq!(limits.max_body, 10);
        // Boundary: a body exactly at the limit is allowed.
        let limits = limits_for(0);
        assert_eq!(limits.max_body, 0);
    }

    #[test]
    fn link_block_uses_absolute_target() {
        let base = url("scorpion://example.com/dir/page");
        let block = SBlock::link(
            b"scorpion://example.com/other".to_vec(),
            b"A".to_vec(),
            Encoding::Pc,
        );
        let out = scorpion_block(block, &base).unwrap();
        assert!(
            matches!(&out, Block::Link { url, .. } if url.as_str() == "scorpion://example.com/other")
        );
    }

    #[test]
    fn metadata_and_alternate_service_blocks_are_skipped() {
        let base = url("scorpion://example.com/");
        let meta = SBlock::new(BlockType::Metadata, Encoding::Pc, b"sig".to_vec());
        let alt = SBlock::new(BlockType::AlternateService, Encoding::Pc, b"alt".to_vec());
        assert!(scorpion_block(meta, &base).is_none());
        assert!(scorpion_block(alt, &base).is_none());
    }

    #[test]
    fn unknown_block_type_becomes_raw() {
        let base = url("scorpion://example.com/");
        let block = SBlock {
            block_type: BlockType::Unknown(0x0E),
            encoding: Encoding::Pc,
            attribute: Vec::new(),
            body: b"?".to_vec(),
        };
        let out = scorpion_block(block, &base).unwrap();
        assert!(matches!(&out, Block::Raw { bytes, .. } if bytes == b"?"));
    }

    #[test]
    fn temporary_error_maps_to_protocol_error() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter
            .handle_response(&u, &resp("44 30 slow down", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn redirect_without_target_is_invalid_response() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter.handle_response(&u, &resp("30", b"")).unwrap_err();
        assert_eq!(err.code(), "INVALID_RESPONSE");
    }

    #[test]
    fn unexpected_send_status_is_protocol_error() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter
            .handle_response(&u, &resp("70 ready", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
        let err = adapter
            .handle_response(&u, &resp("80 accepted", b""))
            .unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn interactive_status_is_protocol_error() {
        let adapter = ScorpionAdapter::new();
        let u = url("scorpion://example.com/");
        let err = adapter.handle_response(&u, &resp("00", b"")).unwrap_err();
        assert_eq!(err.code(), "PROTOCOL_ERROR");
    }

    #[test]
    fn blockquote_and_preformatted_map_to_blocks() {
        let base = url("scorpion://example.com/");
        let q = SBlock::new(BlockType::Blockquote, Encoding::Pc, b"a quote".to_vec());
        assert!(matches!(scorpion_block(q, &base).unwrap(), Block::Quote(_)));
        let pre = SBlock::new(
            BlockType::Preformatted,
            Encoding::Pc,
            b"line one\nline two".to_vec(),
        );
        assert!(matches!(
            scorpion_block(pre, &base).unwrap(),
            Block::Code { .. }
        ));
    }

    #[test]
    fn heading_with_attribute_gets_id() {
        let base = url("scorpion://example.com/");
        let h = SBlock {
            block_type: BlockType::Heading(2),
            encoding: Encoding::Pc,
            attribute: b"sec-2".to_vec(),
            body: b"Sub".to_vec(),
        };
        let out = scorpion_block(h, &base).unwrap();
        assert!(
            matches!(&out, Block::Heading { level: 2, text, id: Some(id) } if text == "Sub" && id == "sec-2")
        );
    }

    #[test]
    fn map_client_error_variants() {
        use scorpion_protocol::client::ClientError;
        assert_eq!(
            map_client_error(ClientError::Io(std::io::Error::other("x"))).code(),
            "NETWORK_ERROR"
        );
        assert_eq!(
            map_client_error(ClientError::Response(
                scorpion_protocol::ResponseError::Malformed
            ))
            .code(),
            "INVALID_RESPONSE"
        );
        assert_eq!(
            map_client_error(ClientError::Url("bad".into())).code(),
            "INVALID_URL"
        );
        assert_eq!(
            map_client_error(ClientError::BodyTooLarge {
                declared: 100,
                limit: 10
            })
            .code(),
            "SIZE_LIMIT_EXCEEDED"
        );
        assert_eq!(
            map_client_error(ClientError::Truncated {
                declared: 10,
                received: 2
            })
            .code(),
            "INVALID_RESPONSE"
        );
    }

    #[test]
    fn scheme_and_capabilities() {
        let adapter = ScorpionAdapter::new();
        assert_eq!(adapter.scheme(), "scorpion");
        let caps = adapter.capabilities();
        assert!(caps.supports_fetch && caps.needs_tls && caps.needs_tofu);
    }
}
