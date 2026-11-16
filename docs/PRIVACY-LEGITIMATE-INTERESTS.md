# Draft legitimate-interest assessment — 16 November 2026

Scope: free hobby browser backgammon; no payments, monetary stakes, cash-out, advertising, analytics trackers, player email registration or data sales. Guest identifiers are pseudonymous personal data, not proof of anonymity. This assessment does not replace identification of the controller, national-law/children review or verification of Cloudflare processing/transfer terms.

## Purpose

Allow a player to join a requested two-player match, reconnect to their seat, exchange short messages, retain cosmetic progression and game statistics, prevent credential guessing, spam and replayed/fabricated rewards. These are concrete service and security interests. Progression produces no legal or similarly significant automated decision; reward rules affect cosmetic game state only.

## Necessity and alternatives

- A random secret is necessary to distinguish seats and browser profiles without requesting a real name, phone number or email. A nickname is sufficient; players are advised not to use real personal details.
- Server-side game/reward authority and minimal idempotency records prevent fabricated results and duplicate rewards. Device-only progress would not support those guarantees.
- Public lobby nicknames are limited to hosts deliberately creating public rooms. Opponent cosmetics and room messages are shown only to participants; public room info does not reveal player identities or disconnected names.
- IP-based request limits support abuse prevention at the edge; the application adds no IP history table. Provider network/log processing is separate and must be verified.
- No optional advertising/analytics code is included. AI/local games need no guest profile creation.

## Balancing and safeguards

Expected uses: requested gameplay and persistent browser progress. Unexpected or harmful uses would include exposing chat to replacement players, leaking opponent credentials in exports, indefinite forgotten profiles, identity linkage, public profiling or tracking children. Mitigations implemented:

- Token-only occupied-seat recovery; password admission cannot claim an existing offline seat.
- Secret profile cookie with HttpOnly, SameSite=Strict, Secure on HTTPS; credentials excluded from URLs, public states and exports.
- Chat length/history and request limits, hide-opponent control, contact route prepared for reports.
- Temporary rooms; profiles expire after 365 days since last initialization. Device data can be cleared; live server profile can be erased without disclosing real-world identity.
- Authenticated export replaces opponent credential keys with export-local labels and allowlists supported record categories.
- No birth date or special-category data is requested. Free text can still contain such data: discourage sharing and handle complaints/erasure promptly.
- No user advertising profiles, external value wagering or cross-device identity linking.

Children may be more vulnerable to chat, unwanted contact, reward mechanics and persistent identifiers. No conclusion is drawn that hobby status removes those risks. Verify target-country age rules and whether additional controls are needed before declaring final readiness; do not collect identity documents merely to add an age label. Maintain an effective monitored contact once supplied.

## Objections and review

Users can stop online use, clear device data, erase their live profile and (once the dedicated mailbox is supplied) submit objections or other rights requests. Assess objections individually, including whether processing must stop and whether a compelling overriding ground or legal claim applies. Do not require email registration to erase a cookie-authenticated guest profile.

Reassess before advertising, public leaderboards, real-value prizes, paid items, accounts/email linking, expanded public chat, new processors or new target audiences. Contractual necessity and consent are not interchangeable fallback labels for processing that fails this balancing test. Final approval remains pending the operator/territory and infrastructure reviews described in PRIVACY-OPERATIONS.md.

## Primary references

- EDPB Guidelines 1/2024, three-part legitimate-interest test: https://www.edpb.europa.eu/documents/guideline/guidelines-12024-on-processing-of-personal-data-based-on-article-61f-gdpr_en
- AEPD legal bases: https://www.aepd.es/preguntas-frecuentes/2-tus-obligaciones-como-responsable-del-tratamiento/5-bases-legitimadoras-del-tratamiento/FAQ-0214-cuales-son-las-bases-de-legitimacion-para-el-tratamiento-de-datos
- AEPD children and consent: https://www.aepd.es/preguntas-frecuentes/10-menores-y-educacion/FAQ-1002-se-puede-recabar-y-tratar-datos-personales-de-menores
