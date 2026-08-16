# Publishing screencappy to the stores

Every release automatically attaches three zips (`screencappy.zip` full build,
`screencappy-store.zip` for store submissions, `screencappy-firefox.zip`). Store
publishing is automated per store below; each job stays dormant until its repo
variable is set to `true` and its secrets exist.

The universal rule: **the first submission to every store is manual**, because no
store API can create a listing or edit listing copy. Automation takes over from
the second version onward. Listing copy, permission justifications, and privacy
answers are prepared in the store pack.

## Chrome Web Store · job `publish-cws`

1. Submit manually once: upload `screencappy-store.zip`, paste the prepared
   listing, pass first review.
2. Create a Google Cloud project, enable the Chrome Web Store API, create OAuth
   credentials, and mint a refresh token.
3. Set secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
   `CWS_REFRESH_TOKEN`, then set repo variable `PUBLISH_TO_CWS=true`.

## Microsoft Edge Add-ons · job `publish-edge`

1. Submit manually once in Partner Center.
2. Partner Center → Microsoft Edge → Publish API → Enable → Create API
   credentials. Note the key's expiry date; it needs rotating.
3. Set secrets `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY`, then set
   repo variable `PUBLISH_TO_EDGE=true`.

The API only pushes packages: metadata edits stay manual in Partner Center.

## Firefox Add-ons · job `publish-firefox`

1. Submit manually once on addons.mozilla.org (the listing needs its copy,
   license, and the zero-data-collection declaration is already in the manifest).
2. addons.mozilla.org → Tools → Manage API Keys: issuer + secret.
3. Set secrets `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, then repo variable
   `PUBLISH_TO_AMO=true`.

Every AMO version passes review; the job submits and exits without waiting.

## Opera · manual only

Opera has no publishing API. Submit `screencappy-store.zip` once at
addons.opera.com/developer and update it opportunistically; Opera users can
also install straight from the Chrome Web Store.

## Safari · not published

See the Safari feasibility analysis in the store pack: the missing downloads
API makes a port real engineering work. Revisit on demand.
