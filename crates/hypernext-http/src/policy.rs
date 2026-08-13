//! SSRF-defense fetch policy.
//!
//! `check_url` validates a URL against a [`FetchPolicy`]: only `http`/`https`
//! schemes are allowed, and — when private-network access is blocked — the
//! host's *resolved* IP is checked, not just the hostname, to defeat
//! DNS-rebinding SSRF (the attacker points a name at a public IP during the
//! check, then rebinds it to a private IP for the actual connection).
//!
//! DNS is injectable via [`DnsResolver`] so tests can mock a hostile resolver;
//! production uses [`SystemDns`] (the platform resolver via
//! `std::net::ToSocketAddrs`).

use std::net::{IpAddr, Ipv6Addr, ToSocketAddrs};
use std::time::Duration;

use url::Url;

use crate::error::Error;

/// Policy governing URL validation and HTTP fetching.
#[derive(Debug, Clone)]
pub struct FetchPolicy {
    /// Maximum number of redirect hops to follow.
    pub max_redirects: usize,
    /// Maximum response body size in bytes. Streaming readers abort past this.
    pub max_response_size: u64,
    /// Per-request timeout.
    pub timeout: Duration,
    /// When true, reject any URL whose resolved address is in a private,
    /// loopback, or link-local range (RFC 1918 / RFC 4193 / loopback).
    pub block_private_network: bool,
    /// Allowed URL schemes (defaults to `http` and `https`).
    pub allowed_schemes: Vec<String>,
}

impl Default for FetchPolicy {
    fn default() -> Self {
        Self {
            max_redirects: 5,
            max_response_size: 10 * 1024 * 1024, // 10 MiB
            timeout: Duration::from_secs(30),
            block_private_network: true,
            allowed_schemes: vec!["http".into(), "https".into()],
        }
    }
}

/// Resolves a hostname to addresses. Abstract so tests can inject a mock.
pub trait DnsResolver {
    /// Resolve `host` to its IP addresses. Failure is an [`Error::Dns`].
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, Error>;
}

/// The production resolver: platform DNS via `std::net::ToSocketAddrs`.
pub struct SystemDns;

impl DnsResolver for SystemDns {
    fn resolve(&self, host: &str) -> Result<Vec<IpAddr>, Error> {
        let addrs = (host, 0u16).to_socket_addrs().map_err(|e| Error::Dns {
            host: host.to_string(),
            source: e,
        })?;
        Ok(addrs.map(|a| a.ip()).collect())
    }
}

/// Validate `url` against `policy` using the system DNS resolver.
pub fn check_url(url: &Url, policy: &FetchPolicy) -> Result<(), Error> {
    check_url_with_resolver(url, policy, &SystemDns)
}

/// Validate `url` against `policy`, resolving DNS via `resolver`.
///
/// Returns `Ok(())` if the URL is allowed; otherwise the specific [`Error`]:
/// `SsrfBlocked` for a disallowed scheme or private resolved IP.
pub fn check_url_with_resolver(
    url: &Url,
    policy: &FetchPolicy,
    resolver: &dyn DnsResolver,
) -> Result<(), Error> {
    let scheme = url.scheme();
    if !policy.allowed_schemes.iter().any(|s| s == scheme) {
        return Err(Error::SsrfBlocked {
            url: url.clone(),
            reason: format!("scheme '{scheme}' not allowed"),
        });
    }

    if !policy.block_private_network {
        return Ok(());
    }

    // If the host is already an IP literal, use it directly (no DNS needed).
    // Match on `url.host()` (not `host_str()`, which returns bracketed IPv6
    // like "[::1]" that fails `IpAddr` parsing) so IPv6 literals — loopback,
    // link-local, ULA, v4-mapped — are classified as private and blocked.
    // Without this, an IPv6-literal URL bypasses the SSRF check by falling
    // through to a DNS lookup of the bracketed string (which never returns a
    // blocked private address).
    let ips: Vec<IpAddr> = match url.host() {
        Some(url::Host::Ipv4(v4)) => vec![IpAddr::V4(v4)],
        Some(url::Host::Ipv6(v6)) => vec![IpAddr::V6(v6)],
        Some(url::Host::Domain(domain)) => resolver.resolve(domain)?,
        None => {
            return Err(Error::SsrfBlocked {
                url: url.clone(),
                reason: "host missing".into(),
            });
        }
    };

    if ips.is_empty() {
        return Err(Error::Dns {
            host: url.host_str().unwrap_or_default().to_string(),
            source: std::io::Error::new(std::io::ErrorKind::NotFound, "no addresses resolved"),
        });
    }

    for ip in ips {
        if is_private_ip(ip) {
            return Err(Error::SsrfBlocked {
                url: url.clone(),
                reason: format!("resolved to private/blocked address {ip}"),
            });
        }
    }

    Ok(())
}

/// True if `ip` is in a private, loopback, link-local, unspecified, or
/// reserved range that must not be fetched when private networks are blocked.
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_unspecified()
                || v4.is_loopback()    // 127.0.0.0/8
                || v4.is_private()     // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                || v4.is_link_local() // 169.254.0.0/16
        }
        IpAddr::V6(v6) => {
            // IPv4-mapped IPv6 (::ffff:a.b.c.d) should be judged by the v4 rules.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(IpAddr::V4(v4));
            }
            v6.is_unspecified()
                || v6.is_loopback()         // ::1
                || is_ipv6_ula(v6)          // fc00::/7 (RFC 4193)
                || is_ipv6_link_local(v6) // fe80::/10
        }
    }
}

/// fc00::/7 — IPv6 unique-local (RFC 4193).
/// (`Ipv6Addr::is_unique_local` is stable only since 1.84; Hypernext MSRV is 1.83.)
fn is_ipv6_ula(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xfe00) == 0xfc00
}

/// fe80::/10 — IPv6 link-local. (`Ipv6Addr` has no `is_link_local` helper.)
fn is_ipv6_link_local(v6: Ipv6Addr) -> bool {
    (v6.segments()[0] & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use std::net::Ipv4Addr;

    /// A mock resolver returning a fixed set of IPs (for DNS-rebinding tests).
    struct MockResolver(Vec<IpAddr>);

    impl DnsResolver for MockResolver {
        fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, Error> {
            Ok(self.0.clone())
        }
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn is_ssrf_blocked(r: Result<(), Error>) -> bool {
        matches!(r, Err(Error::SsrfBlocked { .. }))
    }

    #[test]
    fn https_public_host_ok() {
        let pol = FetchPolicy::default();
        // example.com resolves to a public IP via the real resolver.
        assert!(check_url(&url("https://example.com"), &pol).is_ok());
    }

    #[test]
    fn private_ipv4_loopback_blocked() {
        let pol = FetchPolicy::default();
        assert!(is_ssrf_blocked(check_url(&url("http://127.0.0.1/x"), &pol)));
    }

    #[test]
    fn private_ipv4_rfc1918_blocked() {
        let pol = FetchPolicy::default();
        for host in ["192.168.1.1", "10.0.0.1", "172.16.0.1", "172.31.255.254"] {
            let u = url(&format!("http://{host}/x"));
            assert!(is_ssrf_blocked(check_url(&u, &pol)), "missing {host}");
        }
    }

    #[test]
    fn link_local_v4_and_v6_blocked() {
        let pol = FetchPolicy::default();
        assert!(is_ssrf_blocked(check_url(
            &url("http://169.254.1.1/x"),
            &pol
        )));
        assert!(is_ssrf_blocked(check_url(&url("http://[fe80::1]/x"), &pol)));
    }

    #[test]
    fn ipv6_loopback_and_ula_blocked() {
        let pol = FetchPolicy::default();
        assert!(is_ssrf_blocked(check_url(&url("http://[::1]/x"), &pol)));
        assert!(is_ssrf_blocked(check_url(&url("http://[fd00::1]/x"), &pol)));
    }

    #[test]
    fn ipv4_mapped_ipv6_private_blocked() {
        let pol = FetchPolicy::default();
        // ::ffff:127.0.0.1 is an IPv4-mapped loopback -> blocked.
        assert!(is_ssrf_blocked(check_url(
            &url("http://[::ffff:127.0.0.1]/x"),
            &pol
        )));
    }

    #[test]
    fn file_scheme_blocked() {
        let pol = FetchPolicy::default();
        assert!(is_ssrf_blocked(check_url(&url("file:///etc/passwd"), &pol)));
    }

    #[test]
    fn ftp_scheme_blocked() {
        let pol = FetchPolicy::default();
        assert!(is_ssrf_blocked(check_url(&url("ftp://example.com"), &pol)));
    }

    #[test]
    fn block_private_network_off_allows_loopback() {
        let pol = FetchPolicy {
            block_private_network: false,
            ..FetchPolicy::default()
        };
        assert!(check_url(&url("http://127.0.0.1/x"), &pol).is_ok());
    }

    #[test]
    fn custom_allowed_schemes() {
        let pol = FetchPolicy {
            allowed_schemes: vec!["gemini".into()],
            ..FetchPolicy::default()
        };
        // https not in the allow list now.
        assert!(is_ssrf_blocked(check_url(
            &url("https://example.com"),
            &pol
        )));
    }

    #[test]
    fn dns_rebinding_hostname_resolving_to_loopback_blocked() {
        let pol = FetchPolicy::default();
        let resolver = MockResolver(vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))]);
        // A benign-looking hostname that resolves to loopback must be blocked.
        let u = url("http://attacker.example/x");
        assert!(is_ssrf_blocked(check_url_with_resolver(
            &u, &pol, &resolver
        )));
    }

    #[test]
    fn dns_rebinding_hostname_resolving_to_private_blocked() {
        let pol = FetchPolicy::default();
        let resolver = MockResolver(vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))]);
        let u = url("http://attacker.example/x");
        assert!(is_ssrf_blocked(check_url_with_resolver(
            &u, &pol, &resolver
        )));
    }

    #[test]
    fn dns_rebinding_public_resolution_ok() {
        let pol = FetchPolicy::default();
        let resolver = MockResolver(vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))]);
        let u = url("http://example.com/x");
        assert!(check_url_with_resolver(&u, &pol, &resolver).is_ok());
    }

    #[test]
    fn dns_resolution_failure_surfaces_dns_error() {
        let pol = FetchPolicy::default();
        struct FailResolver;
        impl DnsResolver for FailResolver {
            fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, Error> {
                Err(Error::Dns {
                    host: "nope".into(),
                    source: std::io::Error::new(std::io::ErrorKind::NotFound, "nxdomain"),
                })
            }
        }
        let u = url("http://does-not-exist.invalid/x");
        assert!(matches!(
            check_url_with_resolver(&u, &pol, &FailResolver),
            Err(Error::Dns { .. })
        ));
    }

    #[test]
    fn is_private_ip_truth_table() {
        // private
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3))));
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::new(172, 20, 0, 1))));
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1))));
        // loopback
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(is_private_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        // link-local
        assert!(is_private_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 1, 1))));
        assert!(is_private_ip(IpAddr::V6(std::net::Ipv6Addr::from([
            0xfe80, 0, 0, 0, 0, 0, 0, 1
        ]))));
        // ULA
        assert!(is_private_ip(IpAddr::V6(std::net::Ipv6Addr::from([
            0xfd00, 0, 0, 0, 0, 0, 0, 1
        ]))));
        // IPv4-mapped IPv6 judged by the embedded v4 address
        let mapped_loopback = std::net::Ipv6Addr::from([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
        assert!(is_private_ip(IpAddr::V6(mapped_loopback)));
        // public
        assert!(!is_private_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_private_ip(IpAddr::V6(std::net::Ipv6Addr::from([
            0x2001, 0x4860, 0, 0, 0, 0, 0, 0x8888
        ]))));
    }

    #[test]
    fn missing_host_blocked() {
        // A URL with no host cannot be fetched. `url` 2.5 rejects genuinely
        // hostless forms ("http://", "http://:80/x") at parse time, so the
        // SSRF intent ("must have a verifiable host") is enforced by rejection
        // before `check_url` is ever reached.
        assert!(
            Url::parse("http://").is_err(),
            "hostless http must fail to parse"
        );
        assert!(
            Url::parse("http://:80/x").is_err(),
            "hostless http:port must fail to parse"
        );
        // url 2.5's lenient parser turns "http:///x" into a domain host "x"
        // (it is resolved like any domain, never silently treated as hostless).
        let u = Url::parse("http:///x").unwrap();
        assert_ne!(u.host_str(), Some(""), "parser must not report empty host");
    }

    #[test]
    fn resolver_returning_no_addresses_is_dns_error() {
        let pol = FetchPolicy::default();
        struct EmptyResolver;
        impl DnsResolver for EmptyResolver {
            fn resolve(&self, _host: &str) -> Result<Vec<IpAddr>, Error> {
                Ok(vec![])
            }
        }
        let u = url("http://example.com/x");
        assert!(matches!(
            check_url_with_resolver(&u, &pol, &EmptyResolver),
            Err(Error::Dns { .. })
        ));
    }
}
