//! Integration tests for ad filtering (phase doc 3.3).
//!
//! - Network blocking: a tracker `<img>` is not fetched in reader mode.
//! - Cosmetic hiding: `<div class="ad-banner">` is removed from the extracted
//!   `PageDoc` before readability extraction.
//!
//! Reader mode strips ads from the HTML tree (it does not execute the page's
//! scripts), so the "image not requested" check is exercised via `should_block`
//! against the bundle, and the element-stripping via `extract_doc_filtered`.

use hypernext_http::adblock::RequestType;
use hypernext_http::{AdblockEngine, FetchPolicy, check_url, strip_matching};
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn policy() -> FetchPolicy {
    FetchPolicy {
        block_private_network: false,
        ..FetchPolicy::default()
    }
}

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

/// The bundled EasyList/EasyPrivacy marks doubleclick.net as a tracker.
#[tokio::test]
async fn bundled_engine_blocks_doubleclick_image() {
    let engine = AdblockEngine::new();
    let blocked = engine.should_block(
        &url("https://securepubads.g.doubleclick.net/gpt.js"),
        &url("https://example.com/news"),
        RequestType::Image,
    );
    assert!(blocked, "doubleclick.net image should be blocked by bundle");
}

/// A page containing a tracker image: reader mode never issues a request for
/// it because the renderer (extraction pipeline) only fetches the top-level
/// document; the ad itself is stripped via cosmetic rules.
#[tokio::test]
async fn reader_mode_page_with_tracker_img_extracts_without_ad() {
    // Reader mode never requests the tracker image (it fetches one URL and
    // strips ads from the tree); the ad div is removed via cosmetic rules.
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/tracker-page"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(AD_PAGE.as_bytes().to_vec(), "text/html"),
        )
        .mount(&server)
        .await;

    let pol = policy();
    check_url(&url(&format!("{}/tracker-page", server.uri())), &pol).unwrap();
    let client = hypernext_http::build_client(&pol);

    let doc = hypernext_http::fetch_and_extract_filtered(
        &url(&format!("{}/tracker-page", server.uri())),
        &client,
        &pol,
        &engine(),
    )
    .await
    .unwrap();

    // The ad banner content must not survive into the extracted document.
    let text = doc
        .blocks
        .iter()
        .map(|b| format!("{b:?}"))
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        !text.contains("AD BANNER"),
        "ad banner leaked into extraction; blocks={doc:?}"
    );
    assert!(text.contains("Main article"), "main content present");
}

/// Cosmetic hiding: `<div class="ad-banner">` removed from extracted PageDoc.
#[tokio::test]
async fn cosmetic_rules_strip_ad_banner_from_extracted_doc() {
    let engine = AdblockEngine::new();
    let html = r#"<html><head><title>T</title></head><body>
        <article><h1>Main article</h1><p>Real content here.</p></article>
        <div class="ad-banner-300x250">AD BANNER</div>
    </body></html>"#;
    // Generic class rules (`##.ad-banner-300x250` is in the bundled EasyList)
    // come from the document's classes/ids (adblock-rust two-pass model).
    let selectors = engine.cosmetic_rules_for_document("https://example.com/", html);
    let stripped = strip_matching(html, &selectors);

    assert!(
        !stripped.contains("AD BANNER"),
        "ad-banner should be stripped from the tree; selectors={selectors:?}"
    );
    assert!(stripped.contains("Real content here."));
}

/// `should_block` for a known non-tracker returns false.
#[test]
fn non_tracker_url_not_blocked() {
    let engine = AdblockEngine::new();
    let ok = engine.should_block(
        &url("https://www.rust-lang.org/static/images/rust-logo.svg"),
        &url("https://www.rust-lang.org/"),
        RequestType::Image,
    );
    assert!(!ok);
}

const AD_PAGE: &str = r#"<html><head><title>Tracker page</title></head><body>
    <article><h1>Main article</h1><p>Main article body paragraph.</p></article>
    <div class="ad-banner-300x250">AD BANNER</div>
</body></html>"#;

/// Fetch-and-extract with an adblock engine applied (cosmetic + network).
fn engine() -> AdblockEngine {
    AdblockEngine::new()
}
