# Asset and dependency notices — 16 November 2026

## Browser runtime dependencies

The production browser code imports React, React DOM, scheduler and Zustand. Their installed MIT license texts and versions are included in `apps/web/public/third-party-notices.txt`, linked from the legal pages. Workspace game code is local. Build/type/test dependencies are not shipped merely because they are installed; include their notices if their code or assets are later bundled in production.

`npm audit --omit=dev` reported zero known production vulnerabilities on this date. This is a dependency advisory check, not a guarantee of security or rights clearance.

## Visual and sound inventory

- Board, checkers, themes, dice, app logo and toolbar icons are defined in local TSX/SVG/CSS. No remotely loaded font, photograph, illustration, texture or audio source was found in the current app source.
- Sounds are synthesized with Web Audio. Motion readings remain local.
- Installed PWA icons are local SVG/PNG assets; PNG copies are app logo exports.
- Cosmetic avatars use Unicode emoji rendered by the device/browser. The app does not distribute an external emoji-image pack or font.
- Design screenshots and references under `docs/` are not served as app assets.

Local implementation is not itself proof of original authorship or a license. Preserve design/source provenance for the logo, icon paths and PWA images; check any future imported assets before bundling them. No trademark search or ownership certification for the name Nardy is asserted. Do not add invented copyright owners or a project open-source license without the owner's instruction.

## Changes requiring another review

Remote fonts, stock art, sound files, emoji sprites, ads/SDKs, analytics, copied icon libraries, uploaded player avatars, paid cosmetics or monetary prizes require updated inventory, required attribution and privacy review before release. Keep existing dependency notices when updating versions.
