# Security Policy

## Supported versions

screencappy ships as a browser extension, so there is only ever one supported version: the latest release. Store installs update automatically. If you loaded an unpacked build, pull the [latest release](https://github.com/smollet-app/screencappy/releases/latest) before reporting anything.

| Version | Supported |
| :-- | :-- |
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Please do not open a public issue for a security report.**

Report it privately through GitHub: [Report a vulnerability](https://github.com/smollet-app/screencappy/security/advisories/new). This opens a draft advisory visible only to you and the maintainers, with a private fork to develop the fix in.

If you cannot use GitHub advisories, email `security@smollet.app` instead.
<!-- TODO: confirm this mailbox exists and is monitored, or swap it for the address
     you actually want. If you would rather not publish an email at all, delete this
     line: the advisory link above is sufficient. -->

## What to expect

- Acknowledgement within 5 business days.
- An assessment and a fix timeline within 14 days.
- Credit in the advisory and the release notes, unless you would rather stay anonymous.
- Coordinated disclosure: the advisory is published once a fixed release is out.

## Scope

In scope:

- The extension source in this repository, including the content scripts, the service worker, the editor, and the Turbo (DevTools Protocol) engine.
- The build and release pipeline under `.github/workflows/`.
- Anything that would let a web page read capture data, reach the extension's storage, escalate into the extension's privileges, or trigger a capture without a user gesture.

Out of scope:

- Vulnerabilities in Chrome or Chromium itself. Report those to the [Chrome VRP](https://g.co/chrome/vrp).
- Vulnerabilities in third-party sites that screencappy captures.
- Anything that requires a compromised browser profile, a malicious extension already installed, or physical access to the device.
- The `debugger` permission being powerful. It is opt-in, it is disabled by default, and Chrome shows its own persistent warning banner while it is active. That is the documented design, not a flaw.
- Automated scanner output with no demonstrated impact.

## Design notes relevant to security

These are properties of the extension worth knowing before you dig in, and worth telling us about if you find one of them is not actually true:

- **Zero runtime dependencies.** Nothing in `src/` imports a package. Everything in `package.json` is a devDependency used at build time only. The shipped bundle is code from this repository and nothing else.
- **No network code.** The extension issues no requests. There is no telemetry, no remote configuration, and no remote asset loading.
- **No host permissions.** The manifest declares `activeTab`, `scripting`, `storage`, `downloads`, `contextMenus`, and `unlimitedStorage`. Without host permissions the extension has no standing access to any page and cannot act until the user invokes it.
- **`debugger` is optional.** It is requested at runtime only if the user turns on the Turbo engine in Settings, and it can be revoked at any time.

If you find a way for the extension to reach the network, or to touch a page without a user gesture, treat that as a high severity finding and report it.

## Verifying a build

Releases are built in GitHub Actions from a tagged commit and the packed zip is attached to the release. To check that the zip you downloaded matches what the source produces, build it yourself:

```sh
git checkout v<version>
bun install --frozen-lockfile
bun run zip
```
