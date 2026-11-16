# Excalidraw

Whiteboards, diagrams and page wireframes in an authenticated Verentis workspace.
Install the application, open its workspace launcher, then create or open a
standard `.excalidraw` document. Blank, flowchart and page-wireframe templates use
synthetic content.

The editor is the MIT-licensed upstream Excalidraw component, hosted by Verentis.
Document and PNG/SVG downloads retain portability; images are embedded in saved
JSON. Fonts and editor assets are self-hosted.

The launcher lists workspace files and creates documents under existing workspace
permissions. Editing requires the platform's native collaboration capability and
an authorized installed application. Documents stay read-only when that capability
is unavailable or the connection is interrupted. New documents use the pinned SDK's
conditional create-only upload and require the compatible platform route enforcing
`If-None-Match: *`; an ordinary upload can never serve as an overwrite-prone fallback.
Creation defaults disabled until an operator configures the verified deployed HTTPS
API base. Source-level route tests alone do not enable an unverified target.
Collision and permission failures do not trigger an unconditional retry.
No public sharing, anonymous demo,
offline editing, AI service or upstream Excalidraw cloud-room connection is enabled.

The signed application declares `native-scene-v1`; exact administrator native
consent/proof is still required. Ordinary file-write consent, file type association
and WOPI capability snapshots do not authorize native rooms.

The platform implements native consent/nativeEnabled, persisted exclusive
ownership, atomic Node saves with immutable receipts, recovery/revocation and
private storage. Its persistence metadata and C# were manually aligned under
approval; no Software Factory run is claimed. The platform owner reports
authoritative workspace scene/replay quota and persisted
epoch/reference/in-flight-fenced retention/GC implemented, keeping active history charged and leased zero-byte
tombstones to prevent delayed resurrection. Installed service-chain two/20-client
and latency acceptance, paired Office acceptance, and ordinary publication/journal
quota integration evidence remain unexecuted.
The SDK build and synthetic tests do not establish a production release. Do not
enable editing through a fake native or WOPI runtime.

Limits: 10 MiB per complete document including encoded images, 5 MiB per imported
image, 10,000 scene elements. The platform enforces a room limit of 20 active editor
connections, including separate tabs from the same participant.
Marketplace artwork is a synthetic workflow illustration, not a live screenshot.
