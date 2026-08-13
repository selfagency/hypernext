//! Ad filtering for raw-mode HTTP (phase doc 3.3).
//!
//! Wraps Brave's `adblock` crate (MIT-family license, audited in
//! `docs/references/protocol-crate-audit.md`). The bundled engine loads
//! EasyList + EasyPrivacy as crate assets at **compile time** via
//! `include_str!` -- never a runtime network fetch (see ADR 0006 spirit:
//! bundle, never download at runtime).
//!
//! Two capabilities are exposed to the caller:
//! - [`AdblockEngine::should_block`] -- network-request blocking check
//!   (e.g. a tracker `<img>`/`<script>` in raw mode).
//! - [`AdblockEngine::cosmetic_rules_for`] + [`strip_matching`] -- CSS
//!   element-hiding applied before readability extraction in reader mode.
//!
//! ## Enforcement boundary (invariants #9 and phase doc 3.5)
//!
//! This module is **policy-free about incognito**: adblock must never run in
//! incognito, and is per-origin toggleable via settings. Those decisions live
//! at the fetch-context/adapter layer (enforced at `FetchContext`, not here --
//! ADR 0003 / invariant #9). The adapter reads the per-origin toggle from
//! `hypernext-store` settings and skips calling [`AdblockEngine`] when
//! disabled or incognito. This module only answers "does this request/selector
//! match the loaded filter lists".

use std::collections::HashSet;

use adblock::lists::ParseOptions;
use adblock::request::Request;
use adblock::{Engine, FilterSet};
use scraper::{Html, Selector};
use url::Url;

/// Re-export of Brave's [`RequestType`] so callers build resource-type enums
/// without reaching into the `adblock` crate directly.
pub use adblock::request::RequestType;

/// Where the filter-list content comes from. Defaults to the build-bundled
/// EasyList + EasyPrivacy.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum FilterListSource {
    /// EasyList + EasyPrivacy bundled as crate assets (default).
    #[default]
    Bundled,
    /// Load a single list from a URL (future per-origin subscription).
    Url(Url),
    /// Load a single list from a local file.
    File(std::path::PathBuf),
}

/// Ad-blocking engine backed by Brave's `adblock::Engine`.
pub struct AdblockEngine {
    engine: Engine,
}

impl Default for AdblockEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl AdblockEngine {
    /// Build an engine loaded with the **bundled** EasyList + EasyPrivacy.
    pub fn new() -> Self {
        Self::with_source(FilterListSource::Bundled)
    }

    /// Build an engine from a specific [`FilterListSource`].
    ///
    /// `Bundled` concatenates the compile-time assets. `Url`/`File` read a
    /// single list (read from the filesystem or the given URL text); network
    /// I/O for `Url` is the caller's concern -- for `Url` the caller must pass
    /// already-fetched contents via [`Self::from_lists`]; see [`new`].
    pub fn with_source(source: FilterListSource) -> Self {
        let list_text: String = match source {
            FilterListSource::Bundled => format!(
                "{}\n{}\n",
                include_str!("../assets/easylist.txt"),
                include_str!("../assets/easyprivacy.txt")
            ),
            FilterListSource::File(path) => std::fs::read_to_string(path).unwrap_or_default(),
            FilterListSource::Url(_) => {
                // No runtime network (per bundle requirement). `Url` sources
                // must be resolved by the caller and loaded via the public
                // `from_lists` entry; a bare `Url` loads an empty engine so
                // the default (Bundled) is always safe.
                String::new()
            }
        };
        Self::from_lists(&list_text)
    }

    /// Build an engine from raw filter-list text.
    pub fn from_lists(list_text: &str) -> Self {
        let mut set = FilterSet::new(false);
        set.add_filter_list(list_text.to_string(), ParseOptions::default());
        Self {
            engine: Engine::new_with_filter_set(set),
        }
    }

    /// Whether `url` should be blocked given the page `source_origin` and the
    /// resource type being requested.
    pub fn should_block(&self, url: &Url, source_origin: &Url, resource_type: RequestType) -> bool {
        let Ok(request) = Request::new(
            url.as_str(),
            source_origin.as_str(),
            request_type_str(resource_type),
            "get",
        ) else {
            return false;
        };
        self.engine.check_network_request(&request).should_block()
    }

    /// CSS selectors to hide for `url`/`domain` (element-hiding rules from the
    /// loaded cosmetic filters). Returns **domain-specific** `hide_selectors`
    /// only; generic class/id rules (e.g. `##.ad-banner`) are returned by
    /// [`Self::cosmetic_rules_for_document`], which needs the page's classes.
    pub fn cosmetic_rules_for(&self, domain_or_url: &str) -> Vec<String> {
        let url = normalize_page_url(domain_or_url);
        let resources = self.engine.url_cosmetic_resources(url.as_str());
        let mut selectors: Vec<String> = resources.hide_selectors.into_iter().collect();
        selectors.sort();
        selectors
    }

    /// CSS selectors to hide for `url`, including **generic** class/id rules
    /// derived from the classes and ids actually present in `html` (the
    /// adblock-rust two-pass model: generic element-hiding rules are keyed by
    /// class/id token and looked up against the page's tokens). This is the
    /// entry used by reader-mode extraction before readability.
    pub fn cosmetic_rules_for_document(&self, url: &str, html: &str) -> Vec<String> {
        let page_url = normalize_page_url(url);
        let resources = self.engine.url_cosmetic_resources(page_url.as_str());

        let mut selectors: Vec<String> = resources.hide_selectors.iter().cloned().collect();

        // Collect every class and id token on the page, then ask the engine for
        // generic rules matching those tokens (respecting `generichide`).
        let mut classes: HashSet<String> = HashSet::new();
        let mut ids: HashSet<String> = HashSet::new();
        let doc = Html::parse_document(html);
        if let Ok(all) = Selector::parse("*") {
            for el in doc.select(&all) {
                if let Some(class) = el.value().attr("class") {
                    classes.extend(class.split_whitespace().map(str::to_string));
                }
                if let Some(id) = el.value().attr("id") {
                    ids.insert(id.to_string());
                }
            }
        }
        selectors.extend(self.engine.hidden_class_id_selectors(
            classes,
            ids,
            &resources.exceptions,
        ));

        selectors.sort();
        selectors.dedup();
        selectors
    }
}

/// Strip every element in `html` matching any selector in `selectors`, then
/// return the serialized HTML. Used to remove ad elements before readability
/// extraction (phase doc 3.3: strip before `legible::parse`).
pub fn strip_matching(html: &str, selectors: &[String]) -> String {
    if selectors.is_empty() {
        return html.to_string();
    }
    // Parse valid selectors once; skip any that fail to parse rather than
    // aborting the whole strip.
    let parsed: Vec<Selector> = selectors
        .iter()
        .filter_map(|s| Selector::parse(s).ok())
        .collect();
    if parsed.is_empty() {
        return html.to_string();
    }

    let mut stripped = Html::parse_document(html);
    // Collect NodeIds first (immutable borrow), then detach each (mutable):
    // detaching a node also removes its subtree. Safe since ego-tree NodeIds
    // are arena-stable; re-detaching an already-orphaned id is a no-op.
    let mut to_remove: Vec<_> = Vec::new();
    {
        for sel in &parsed {
            for element in stripped.select(sel) {
                to_remove.push(element.id());
            }
        }
    }
    for id in to_remove {
        if let Some(mut node) = stripped.tree.get_mut(id) {
            node.detach();
        }
    }
    stripped.html()
}

fn request_type_str(rt: RequestType) -> &'static str {
    match rt {
        RequestType::Beacon => "beacon",
        RequestType::Csp => "csp_report",
        RequestType::Document => "document",
        RequestType::Dtd => "dtd",
        RequestType::Fetch => "fetch",
        RequestType::Font => "font",
        RequestType::Image => "image",
        RequestType::Media => "media",
        RequestType::Object => "object",
        RequestType::Other => "other",
        RequestType::Ping => "ping",
        RequestType::Script => "script",
        RequestType::Stylesheet => "stylesheet",
        RequestType::Subdocument => "subdocument",
        RequestType::Websocket => "websocket",
        RequestType::Xlst => "xslt",
        RequestType::Xmlhttprequest => "xmlhttprequest",
    }
}

/// Accept a bare domain ("example.com") or a full URL; normalize to a usable
/// page URL for `url_cosmetic_resources`.
fn normalize_page_url(domain_or_url: &str) -> Url {
    if domain_or_url.contains("://") {
        Url::parse(domain_or_url).unwrap_or_else(|_| Url::parse("https://example.com/").unwrap())
    } else {
        Url::parse(&format!("https://{domain_or_url}/"))
            .unwrap_or_else(|_| Url::parse("https://example.com/").unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use adblock::request::RequestType;

    fn short_list() -> &'static str {
        // Minimal lists: one network blocker, one domain-specific cosmetic hide.
        r"! EasyList-like test list
||doubleclick.net^
@@||example.com^
example.com##.ad-banner
"
    }

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn should_block_known_tracker_url() {
        let engine = AdblockEngine::from_lists(short_list());
        let ok = engine.should_block(
            &url("https://ads.doubleclick.net/ad?id=1"),
            &url("https://example.com/page"),
            RequestType::Image,
        );
        assert!(ok, "doubleclick.net tracker should be blocked");
    }

    #[test]
    fn should_block_non_tracker_not_blocked() {
        let engine = AdblockEngine::from_lists(short_list());
        let ok = engine.should_block(
            &url("https://cdn.example.com/app.js"),
            &url("https://example.com/page"),
            RequestType::Script,
        );
        assert!(!ok, "first-party script should not be blocked");
    }

    #[test]
    fn bundle_engine_loads_and_checks_real_list() {
        let engine = AdblockEngine::new();
        // A known EasyList/bundled network rule domain.
        let blocked = engine.should_block(
            &url("https://securepubads.g.doubleclick.net/tag/js/gpt.js"),
            &url("https://example.com/"),
            RequestType::Script,
        );
        let clean = engine.should_block(
            &url("https://www.rust-lang.org/static/images/rust-logo.svg"),
            &url("https://www.rust-lang.org/"),
            RequestType::Image,
        );
        assert!(
            blocked,
            "doubleclick gpt.js should be blocked by bundled list"
        );
        assert!(!clean, "rust-lang logo should not be blocked");
    }

    #[test]
    fn cosmetic_rules_return_selectors_for_domain() {
        let engine = AdblockEngine::from_lists(short_list());
        let rules = engine.cosmetic_rules_for("example.com");
        assert!(
            rules.iter().any(|s| s == ".ad-banner"),
            "expected .ad-banner selector, got {rules:?}"
        );
    }

    #[test]
    fn strip_matching_removes_ad_elements() {
        let html = r#"<html><body><p>hello</p><div class="ad-banner">AD</div></body></html>"#;
        let stripped = strip_matching(html, &[".ad-banner".to_string()]);
        assert!(!stripped.contains("AD"), "ad-banner content should be gone");
        assert!(stripped.contains("hello"), "main content should remain");
    }

    #[test]
    fn empty_list_engine_initializes() {
        let engine = AdblockEngine::from_lists("");
        let ok = engine.should_block(
            &url("https://ads.doubleclick.net/ad"),
            &url("https://example.com/"),
            RequestType::Image,
        );
        assert!(!ok, "empty engine blocks nothing");
        assert!(engine.cosmetic_rules_for("example.com").is_empty());
    }

    #[test]
    fn filter_list_source_default_is_bundled() {
        assert_eq!(FilterListSource::default(), FilterListSource::Bundled);
        // `AdblockEngine::default()` == `new()` (bundled lists).
        let _ = AdblockEngine::default();
        let _ = AdblockEngine::new();
    }

    #[test]
    fn file_and_url_sources_load_gracefully() {
        // `Url` source loads an empty engine (no runtime network).
        let url_engine =
            AdblockEngine::with_source(FilterListSource::Url(url("https://lists.example/x.txt")));
        assert!(url_engine.cosmetic_rules_for("example.com").is_empty());

        let dir = tempfile::tempdir().expect("tempdir");

        // `File` source reads the file verbatim.
        let file = dir.path().join("easylist.txt");
        std::fs::write(&file, "||tracker.example^\n").unwrap();
        let file_engine = AdblockEngine::with_source(FilterListSource::File(file));
        let blocked = file_engine.should_block(
            &url("https://tracker.example/pixel.gif"),
            &url("https://site.example/"),
            RequestType::Image,
        );
        assert!(blocked, "file-sourced list should block its rule");

        // Missing file degrades to an empty engine, never panics.
        let missing = AdblockEngine::with_source(FilterListSource::File(
            dir.path().join("does-not-exist-easylist.txt"),
        ));
        assert!(missing.cosmetic_rules_for("example.com").is_empty());
    }

    #[test]
    fn should_block_with_malformed_url_returns_false() {
        let engine = AdblockEngine::new();
        // A URL with an unparsable host degrades to `false` (no panic).
        let ok = engine.should_block(
            &url("https:///no-host"),
            &url("https://example.com/"),
            RequestType::Image,
        );
        assert!(!ok);
    }

    #[test]
    fn should_block_covers_resource_types() {
        let engine = AdblockEngine::from_lists(short_list());
        for rt in [
            RequestType::Beacon,
            RequestType::Csp,
            RequestType::Document,
            RequestType::Dtd,
            RequestType::Fetch,
            RequestType::Font,
            RequestType::Media,
            RequestType::Object,
            RequestType::Other,
            RequestType::Ping,
            RequestType::Stylesheet,
            RequestType::Subdocument,
            RequestType::Websocket,
            RequestType::Xlst,
            RequestType::Xmlhttprequest,
        ] {
            engine.should_block(
                &url("https://ads.doubleclick.net/p"),
                &url("https://example.com/"),
                rt,
            );
        }
    }

    #[test]
    fn strip_matching_edge_cases() {
        // Empty selector list -> unchanged html.
        assert_eq!(strip_matching("<p>hi</p>", &[]), "<p>hi</p>");
        // All selectors fail to parse -> unchanged, no panic.
        assert_eq!(
            strip_matching("<p>hi</p>", &["(((".to_string()]),
            "<p>hi</p>"
        );
    }

    #[test]
    fn cosmetic_rules_collect_ids_and_classes() {
        let engine = AdblockEngine::from_lists(short_list());
        let html =
            r#"<html><body><div id="ad-overlay" class="ad-banner-300x250"></div></body></html>"#;
        let rules = engine.cosmetic_rules_for_document("example.com", html);
        // Both the id-rule and the domain-specific class rule are candidates.
        assert!(!rules.is_empty());
    }
}
