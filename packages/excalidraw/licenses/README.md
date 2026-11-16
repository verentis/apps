# Redistributed editor and font notices

Excalidraw 0.18.0 is MIT-licensed. Font licenses are separate:
Comic Shanns is MIT; Assistant, Cascadia Code, Excalifont, Lilita One,
Nunito, Virgil and Xiaolai are SIL Open Font License 1.1.
The accompanying text files retain copyright and license notices.

The upstream package's Liberation Sans 1.05 is **not** included in the served
application: the asset-copy step substitutes unmodified glyphs from
Liberation Sans 2.1.5, licensed under OFL 1.1. The TrueType distribution was
converted to WOFF2 using fontTools; glyphs and metrics are unchanged. To respect
the OFL reserved font name, the derivative's internal names are **Verentis Sans**.
The legacy URL filename is only the upstream engine's compatibility lookup slot,
not this derivative's font-family identity.
Its download source is the official release:
<https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5>.
The package contains that WOFF2 asset in `vendor/fonts/` and the reproducible
conversion script in `scripts/build-compat-font.py`. The upstream license,
copyright and reserved-name notices remain unchanged.
Conversion-only Python dependencies are listed in `scripts/requirements-fonts.txt`;
normal install/build/test does not require Python or a network font fetch.

All font notices are copied alongside the self-hosted font assets at
`/excalidraw-assets/licenses/`. Excalifont is a trademark of Excalidraw;
font ownership does not imply endorsement of this wrapper.

## Manifest icon

`icons/excalidraw.svg` is the Excalidraw mark from the theSVG Color set (https://github.com/glincker/thesvg, MIT),
retrieved via Iconify (`thesvg-color:excalidraw`). The Excalidraw name and mark remain their owners' property.
