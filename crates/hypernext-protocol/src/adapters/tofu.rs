//! Shared trust-on-first-use (TOFU) TLS pinning for the TLS-bearing adapters
//! (Gemini, Scorpion over `scorpions://`, Kepler over `keplers://`).
//!
//! Each protocol pins the leaf certificate's SHA-256 in the `tofu_certs`
//! table (keyed by host) on first contact; a later visit presenting a
//! different certificate fails with [`HypernextError::TofuCertChanged`]
//! before any request byte is sent. Pins live in the per-call
//! `FetchContext::store` connection, matching the single-process
//! architecture (ADR 0003).

use std::sync::{Arc, Mutex};

use hypernext_core::HypernextError;
use rusqlite::OptionalExtension;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use tokio_rustls::TlsConnector;

use crate::dispatcher::FetchContext;

/// What a pinning handshake saw: the leaf fingerprint and its DER bytes.
#[derive(Clone, Debug)]
pub(crate) struct SeenCert {
    pub(crate) fingerprint: [u8; 32],
    pub(crate) der: Vec<u8>,
}

pub(crate) type SeenCell = Arc<Mutex<Option<SeenCert>>>;

/// A TLS connector that pins the leaf certificate against `pinned` (or
/// accepts a first contact), recording what it saw for the caller to pin or
/// to build a `TofuCertChanged` error.
pub(crate) fn pinning_connector(pinned: Option<[u8; 32]>) -> (TlsConnector, SeenCell) {
    let seen: SeenCell = Arc::new(Mutex::new(None));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("ring provides the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinningVerifier {
            pinned,
            seen: Arc::clone(&seen),
        }))
        .with_no_client_auth();
    (TlsConnector::from(Arc::new(config)), seen)
}

const ACCEPTED_SCHEMES: [SignatureScheme; 10] = [
    SignatureScheme::RSA_PKCS1_SHA256,
    SignatureScheme::RSA_PKCS1_SHA384,
    SignatureScheme::RSA_PKCS1_SHA512,
    SignatureScheme::ECDSA_NISTP256_SHA256,
    SignatureScheme::ECDSA_NISTP384_SHA384,
    SignatureScheme::ECDSA_NISTP521_SHA512,
    SignatureScheme::RSA_PSS_SHA256,
    SignatureScheme::RSA_PSS_SHA384,
    SignatureScheme::RSA_PSS_SHA512,
    SignatureScheme::ED25519,
];

/// Pins the leaf against `pinned`: records what it saw, accepts a first
/// contact or a matching pin, rejects a changed certificate. CA-chain
/// validation is intentionally skipped — the smolnet protocols have no CA
/// system.
#[derive(Debug)]
struct PinningVerifier {
    pinned: Option<[u8; 32]>,
    seen: SeenCell,
}

impl ServerCertVerifier for PinningVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let der = end_entity.as_ref().to_vec();
        let fingerprint = fingerprint(&der);
        *self.seen.lock().unwrap() = Some(SeenCert { fingerprint, der });
        match self.pinned {
            None => Ok(ServerCertVerified::assertion()),
            Some(pinned) if pinned == fingerprint => Ok(ServerCertVerified::assertion()),
            Some(_) => Err(rustls::Error::General(
                "tofu: certificate fingerprint changed".into(),
            )),
        }
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        ACCEPTED_SCHEMES.to_vec()
    }
}

/// Look up the pinned fingerprint for `host`, or `None` on first contact.
pub(crate) fn lookup_pin(
    host: &str,
    ctx: &FetchContext<'_>,
) -> Result<Option<[u8; 32]>, HypernextError> {
    let conn = ctx
        .store
        .lock()
        .map_err(|_| HypernextError::Storage("tofu store poisoned".into()))?;
    let fp: Option<String> = conn
        .query_row(
            "SELECT fingerprint FROM tofu_certs WHERE host = ?1",
            [host],
            |row| row.get(0),
        )
        .optional()?;
    match fp {
        Some(hex) => Ok(Some(hex_to_bytes(&hex)?)),
        None => Ok(None),
    }
}

/// Record a first-contact pin in the `tofu_certs` table.
pub(crate) fn store_pin(
    host: &str,
    fingerprint: [u8; 32],
    der: &[u8],
    ctx: &FetchContext<'_>,
) -> Result<(), HypernextError> {
    let conn = ctx
        .store
        .lock()
        .map_err(|_| HypernextError::Storage("tofu store poisoned".into()))?;
    conn.execute(
        "INSERT OR REPLACE INTO tofu_certs (host, fingerprint, pem) VALUES (?1, ?2, ?3)",
        rusqlite::params![host, hex(&fingerprint), der],
    )?;
    Ok(())
}

/// Lowercase-hex of a fingerprint.
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Parse a 64-char lowercase-hex fingerprint back into 32 bytes.
pub(crate) fn hex_to_bytes(s: &str) -> Result<[u8; 32], HypernextError> {
    if s.len() != 64 {
        return Err(HypernextError::Storage("invalid fingerprint length".into()));
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
            .map_err(|e| HypernextError::Storage(e.to_string()))?;
    }
    Ok(out)
}

/// SHA-256 of a certificate's DER bytes.
pub(crate) fn fingerprint(cert_der: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(cert_der);
    hasher.finalize().into()
}

/// Open a TOFU-pinned TLS connection to `host:port`, honoring the cancel
/// token around the handshake.
///
/// On first contact the leaf certificate is pinned in the `tofu_certs` table;
/// a later visit presenting a different certificate fails with
/// [`HypernextError::TofuCertChanged`] before any request byte is sent.
/// Returns the established TLS stream, ready for the protocol exchange.
pub(crate) async fn tls_connect(
    host: &str,
    port: u16,
    ctx: &FetchContext<'_>,
) -> Result<tokio_rustls::client::TlsStream<tokio::net::TcpStream>, HypernextError> {
    let pinned = lookup_pin(host, ctx)?;
    let (connector, seen) = pinning_connector(pinned);

    let tcp = tokio::net::TcpStream::connect((host, port))
        .await
        .map_err(|e| HypernextError::Network(format!("tcp {host}:{port}: {e}")))?;
    let server_name = ServerName::try_from(host.to_string())
        .map_err(|e| HypernextError::Network(format!("server name {host}: {e}")))?;

    let connect = connector.connect(server_name, tcp);
    let cancel = ctx.cancel.clone();
    let stream = tokio::select! {
        _ = cancel.cancelled() => return Err(HypernextError::Cancelled),
        r = connect => {
            match r {
                Ok(tls) => tls,
                Err(e) => {
                    let seen = seen.lock().unwrap().clone();
                    if let (Some(pinned), Some(seen)) = (pinned, seen)
                        && pinned != seen.fingerprint
                    {
                        return Err(HypernextError::TofuCertChanged(format!(
                            "certificate for {host} changed: pinned {}, saw {}",
                            hex(&pinned),
                            hex(&seen.fingerprint)
                        )));
                    }
                    return Err(HypernextError::Network(format!("tls handshake: {e}")));
                }
            }
        }
    };

    // Clean first contact: pin the fingerprint and store the leaf DER.
    if pinned.is_none()
        && let Some(seen) = seen.lock().unwrap().take()
    {
        store_pin(host, seen.fingerprint, &seen.der, ctx)?;
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_hex_round_trips() {
        let mut fp = [0u8; 32];
        fp[0] = 0xde;
        fp[1] = 0xad;
        fp[2] = 0xbe;
        fp[3] = 0xef;
        let h = hex(&fp);
        assert_eq!(h.len(), 64);
        assert_eq!(hex_to_bytes(&h).unwrap(), fp);
        assert!(hex_to_bytes("short").is_err());
    }

    #[test]
    fn fingerprint_is_sha256_of_der() {
        let fp = fingerprint(b"cert-der");
        assert_eq!(fp.len(), 32);
        // Deterministic: same input, same output.
        assert_eq!(fingerprint(b"cert-der"), fp);
        assert_ne!(fingerprint(b"other"), fp);
    }
}
