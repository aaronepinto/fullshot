# roadmap

What ships in the initial release is the current feature set, hardened. Items
below are deliberately deferred: each was validated against real user demand
(mined from competitors' reviews) but none is essential to capturing a page
correctly today. Order within a section is rough priority, not commitment.

## next minor releases

- **Evidence stamp.** An optional footer stamping the source URL and capture
  time onto exports. Requested repeatedly by people using captures as evidence;
  the editor already holds both values.
- **True tabless quiet save.** "Download immediately" currently opens the editor
  tab unfocused and closes it when the download completes. The clean version
  moves export into an offscreen document so no tab exists at all.
- **Download subfolder.** Allow one subfolder segment in the filename template,
  for example `screencappy/{domain} {date}`, with per-segment sanitizing.
- **Capture from current position.** A "full page from here" mode that starts at
  the current scroll offset instead of the top.

## later

- **Batch export to one PDF.** Combine several history captures into a single
  PDF document.
- **AVIF export.** Alongside PNG, JPEG and WebP, once encoder support in
  extension pages is dependable.
- **Safari port.** Blocked on the missing downloads API; see the feasibility
  notes in the store pack.

## non-goals

- Accounts, cloud storage, telemetry, or any network egress. The product stays
  local by design.
- A paid tier. Capabilities never move behind payment.
