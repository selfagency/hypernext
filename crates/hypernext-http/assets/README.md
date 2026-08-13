# Bundled ad-filter lists (EasyList + EasyPrivacy)

These filter lists are bundled as build-time crate assets for the
`hypernext-http` adblock engine (`AdblockEngine`). They are embedded at
compile time via `include_str!` -- never fetched over the network at runtime.

## Sources (snapshot date 2026-08-12)

- `easylist.txt` -- EasyList, downloaded from <https://easylist.to/easylist/easylist.txt>
- `easyprivacy.txt` -- EasyPrivacy, downloaded from <https://easylist.to/easylist/easyprivacy.txt>

Each file retains its in-band `! Version:` / `! Last modified:` header, which
records the exact upstream snapshot.

## License

EasyList and EasyPrivacy are dual-licensed by the EasyList authors:

- GNU General Public License version 3.0 (or any later version)
  <https://www.gnu.org/licenses/gpl-3.0.en.html>
- Creative Commons Attribution-ShareAlike 3.0 Unported (or any later version)
  <https://creativecommons.org/licenses/by-sa/3.0/>

See <https://easylist.to/pages/licence.html> and
<https://github.com/easylist/easylist> for the authoritative terms.

Redistribution terms: both licenses permit redistribution of the lists when
the upstream attribution and license notice are retained (as done here).
As prescribed by the license, this project attributes the material to
"The EasyList authors (<https://easylist.to/>)". These are data assets, not
source code linked into the program; Hypernext's own MIT license is
unaffected. Contact the maintainer before altering or re-licensing these
files.
