#!/usr/bin/env python3
"""Generate Scorpion binary-block fixture files for the integration tests.

Each fixture is a full wire response: a status line followed by a binary
Scorpion document (packed type+encoding byte, 16-bit attribute length,
attribute, 24-bit body length, body).

Usage: python3 scripts/gen_scorpion_fixtures.py
"""
import struct
import os

OUT = os.path.join(
    os.path.dirname(__file__),
    "..",
    "crates",
    "hypernext-protocol",
    "tests",
    "fixtures",
    "scorpion",
)


def block(block_type, body, attribute=b"", encoding=0x10):
    """Encode one Scorpion document block. encoding high nibble | type low."""
    tag = encoding | block_type
    out = bytearray()
    out.append(tag)
    out += struct.pack(">H", len(attribute))
    out += attribute
    out += struct.pack(">I", len(body))[1:]  # 24-bit big-endian
    out += body
    return bytes(out)


def response(status_line, body):
    return status_line.encode() + b"\r\n" + body


def main():
    os.makedirs(OUT, exist_ok=True)

    # 1. A document with a heading, a paragraph, and a link (happy path).
    doc = (
        block(0x01, b"Title", attribute=b"top")  # Heading(1)
        + block(0x00, b"Some paragraph text.")  # Paragraph
        + block(0x08, b"Next", attribute=b"scorpion://example.com/next")  # Link
    )
    with open(os.path.join(OUT, "document.scorpion"), "wb") as f:
        f.write(response(f"20 {len(doc)} text/scorpion", doc))

    # 2. A plain-text document (single paragraph).
    doc = block(0x00, b"just some plain text")
    with open(os.path.join(OUT, "plain.scorpion"), "wb") as f:
        f.write(response(f"20 {len(doc)} text/plain", doc))

    # 3. A preformatted block.
    doc = block(0x0D, b"line one\nline two")
    with open(os.path.join(OUT, "preformatted.scorpion"), "wb") as f:
        f.write(response(f"20 {len(doc)} text/scorpion", doc))

    # 4. A blockquote.
    doc = block(0x0C, b"a quoted line")
    with open(os.path.join(OUT, "quote.scorpion"), "wb") as f:
        f.write(response(f"20 {len(doc)} text/scorpion", doc))

    # 5. A redirect (no body).
    with open(os.path.join(OUT, "redirect.scorpion"), "wb") as f:
        f.write(b"31 scorpion://example.com/moved\r\n")

    # 6. A not-found (no body).
    with open(os.path.join(OUT, "notfound.scorpion"), "wb") as f:
        f.write(b"51 no such file\r\n")

    print(f"wrote fixtures to {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
