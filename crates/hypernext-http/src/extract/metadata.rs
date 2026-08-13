//! Metadata extraction: `<meta>`, OG/Twitter, JSON-LD, h-card microformats.

use std::collections::HashMap;

use hypernext_core::Metadata;
use scraper::{Html, Selector};
use url::Url;

use super::classify::resolve_url;

/// Parse metadata from the HTML document. Orchestrates small per-source
/// extractors so each keeps low cyclomatic complexity.
pub(crate) fn parse_metadata(html: &str, base: &Url) -> (Metadata, Vec<String>) {
    let doc = Html::parse_document(html);
    let mut m = Metadata::default();
    let mut decisions = Vec::new();

    extract_head_meta(&doc, base, &mut m, &mut decisions);
    extract_link_tags(&doc, base, &mut m, &mut decisions);
    extract_json_ld(&doc, &mut m, &mut decisions);
    extract_microformats(&doc, &mut m, &mut decisions);

    (m, decisions)
}

/// Collect `<title>` plus `<meta name|property>` values, folding OG/Twitter into
/// their maps and direct description/author into the metadata.
fn extract_head_meta(doc: &Html, base: &Url, m: &mut Metadata, decisions: &mut Vec<String>) {
    if let Some(t) = doc.select(&Selector::parse("title").unwrap()).next() {
        let text = t.text().collect::<String>().trim().to_string();
        if !text.is_empty() {
            m.title = Some(text);
        }
    }

    let mut og: HashMap<String, String> = HashMap::new();
    let mut twitter: HashMap<String, String> = HashMap::new();
    for meta in doc.select(&Selector::parse("meta").unwrap()) {
        let name = meta.value().attr("name").map(|s| s.to_ascii_lowercase());
        let property = meta
            .value()
            .attr("property")
            .map(|s| s.to_ascii_lowercase());
        let content = meta.value().attr("content").unwrap_or("").to_string();
        if let Some(name) = name {
            match name.as_str() {
                "description" => m.description = Some(content),
                "author" => m.author = Some(content),
                _ if name.starts_with("twitter:") => {
                    twitter.insert(name, content);
                }
                _ => {}
            }
        } else if let Some(property) = property
            && property.starts_with("og:")
        {
            og.insert(property, content);
        }
    }

    apply_og(base, m, og, twitter, decisions);
}

/// Fold collected OG/Twitter maps into the metadata (description, title,
/// site_name, canonical, featured_image), leaving unset fields alone.
fn apply_og(
    base: &Url,
    m: &mut Metadata,
    og: HashMap<String, String>,
    twitter: HashMap<String, String>,
    decisions: &mut Vec<String>,
) {
    if let Some(d) = og.get("og:description") {
        m.description.get_or_insert_with(|| d.clone());
    }
    if let Some(s) = og.get("og:site_name") {
        m.site_name = Some(s.clone());
        decisions.push("metadata: og:site_name".to_string());
    }
    if let Some(t) = og.get("og:title") {
        decisions.push("metadata: og:title".to_string());
        if m.title.is_none() {
            m.title = Some(t.clone());
        }
    }
    if let Some(u) = og.get("og:url")
        && let Ok(url) = Url::parse(u)
    {
        m.canonical_url.get_or_insert(url);
        decisions.push("metadata: og:url/canonical".to_string());
    }
    if let Some(img) = og.get("og:image")
        && let Some(url) = resolve_url(base, img)
    {
        m.featured_image = Some(url);
        decisions.push("metadata: og:image".to_string());
    }
    m.og = og;
    m.twitter = twitter;
}

/// `<link rel=canonical|icon>` resolution.
fn extract_link_tags(doc: &Html, base: &Url, m: &mut Metadata, decisions: &mut Vec<String>) {
    for link in doc.select(&Selector::parse("link").unwrap()) {
        let rel = link.value().attr("rel").map(|s| s.to_ascii_lowercase());
        let href = link.value().attr("href").unwrap_or("");
        match rel.as_deref() {
            Some("canonical") => {
                if let Ok(u) = base.join(href) {
                    // <link rel=canonical> is authoritative over og:url.
                    m.canonical_url = Some(u);
                    decisions.push("metadata: link canonical".to_string());
                }
            }
            Some("icon") => {
                if let Ok(u) = base.join(href) {
                    m.favicon_url.get_or_insert(u);
                }
            }
            _ => {}
        }
    }
}

/// JSON-LD `<script type="application/ld+json">` blocks.
fn extract_json_ld(doc: &Html, m: &mut Metadata, decisions: &mut Vec<String>) {
    let json_ld_sel = Selector::parse(r#"script[type="application/ld+json"]"#).unwrap();
    for script in doc.select(&json_ld_sel) {
        let raw = script.text().collect::<String>();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            m.json_ld.push(value);
            decisions.push("metadata: json-ld".to_string());
        }
    }
}

/// Microformats h-card -> author.
fn extract_microformats(doc: &Html, m: &mut Metadata, decisions: &mut Vec<String>) {
    for card in doc.select(&Selector::parse("[class*='h-card']").unwrap()) {
        let name_sel = Selector::parse(".p-name").unwrap();
        if let Some(name) = card.select(&name_sel).next() {
            let text = name.text().collect::<String>().trim().to_string();
            if !text.is_empty() {
                m.author = Some(text);
                decisions.push("metadata: microformats h-card author".to_string());
                break;
            }
        }
    }
}
