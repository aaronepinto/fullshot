# New repo recipe

A reusable checklist distilled from the 2026 research in `SPEC.md`. Copy this file into any new project and work down it. Roughly 90 minutes for a full pass on a fresh repo, and most of it is copy and paste.

The files in this directory are the templates. Search and replace these four strings and most of the work is done:

| Placeholder | Example |
| :-- | :-- |
| `aaronepinto/fullshot` | `owner/repo` |
| `FullShot` | project name |
| `fullshot.smollet.app` | docs or product site |
| `security@smollet.app` | security contact, or delete the line |

---

## 1. Files at the repo root

- [ ] `README.md` (structure below)
- [ ] `LICENSE`
- [ ] `CONTRIBUTING.md`
- [ ] `SECURITY.md`
- [ ] `CODE_OF_CONDUCT.md`: generate Contributor Covenant 2.1 from the Insights tab, do not hand-write it. Covenant 3.0 exists as of July 2025 but adoption is still near zero, so 2.1 remains the safe default.

## 2. Files under `.github/`

- [ ] `dependabot.yml`: your package ecosystem plus `github-actions`. Use `directory: /` for both, including actions.
- [ ] `PULL_REQUEST_TEMPLATE.md`: Summary plus Test Plan. Nothing longer.
- [ ] `ISSUE_TEMPLATE/config.yml`: `blank_issues_enabled: false` plus contact links.
- [ ] `ISSUE_TEMPLATE/bug_report.yml`
- [ ] `ISSUE_TEMPLATE/feature_request.yml`
- [ ] Do **not** add a `type:` key to issue forms on a user-owned repo. GitHub issue types are organization-only as of August 2026 and the form will not render. Use labels. Add `type:` only if the repo lives under an org.
- [ ] `ISSUE_TEMPLATE/<domain>.yml`: **the one that matters.** Every project has one class of report that is worthless without a specific artifact. Make a dedicated form that requires it. For a browser extension it is a public URL. For a CLI it is the exact command plus `--version` output. For a library it is a minimal reproduction link. Say in the field description that reports without it will be closed.
- [ ] `release.yml`: categorises the auto-generated release notes.
- [ ] `workflows/ci.yml`
- [ ] `workflows/codeql.yml` for JS/TS. Use `language: javascript-typescript` and `build-mode: none`, on `github/codeql-action/*@v4`. Commit it rather than using default setup, because default setup silently stops its weekly schedule after 6 months of repo inactivity.
- [ ] `FUNDING.yml` if you take sponsorship. One line.

## 3. Workflow hygiene, on every workflow

- [ ] `permissions: {}` at the top level, grant the minimum per job.
- [ ] `persist-credentials: false` on every `actions/checkout`, otherwise credentials sit in `.git/config` for every later step.
- [ ] SHA-pin every action to a full 40-character SHA with a trailing `# vX.Y.Z` comment. Run `pinact run` to do the whole tree at once. Dependabot keeps both the SHA and the comment fresh afterwards. Never pin a short SHA.
- [ ] `concurrency:` with `cancel-in-progress: true` on CI.
- [ ] `timeout-minutes` on every job.
- [ ] Run `uvx zizmor .github/workflows/` once and fix what it finds.

## 4. README structure

The order the best 2026 READMEs converge on:

1. Hero: logo in a `<div align="center">`, using `<picture>` with `prefers-color-scheme` if you have light and dark marks
2. One-line tagline in bold
3. Badge row: **3 to 5 badges, no more**
4. Nav links: `[Docs](...) • [Download](...) • [Changelog](...)`
5. Hero image: a screenshot for an app, a benchmark chart for a tool, a GIF if you can
6. Two paragraphs of what this is and why it exists
7. Install
8. Features (bullets with bold labels, not a wall of prose)
9. Usage or keyboard shortcuts
10. Architecture, if the project is worth explaining
11. Contributing (a link, one to three lines, never inline guidelines)
12. License
13. Sponsors, last, always an auto-generated SVG

**Badges.** Colour-coordinate them: give every shields badge the same `labelColor=` and `color=` drawn from your product's palette. That one detail is what separates a considered badge row from a default one.

```markdown
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/OWNER/REPO?labelColor=0f172a&color=0ea5e9)](https://github.com/OWNER/REPO/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0f172a&color=0ea5e9)](LICENSE)
```

**Do not:** exceed about 6 badges, use `for-the-badge` style, add a coverage badge, add a `## Table of Contents`, use `<details>` collapsibles, build a competitor comparison table, use `#gh-dark-mode-only` image hacks, or duplicate your docs site.

**Emoji.** In feature bullets, fine and normal. In section headers, a minority style that reads indie rather than serious. Pick one register and hold it. If you use them in headers, use them on *every* header, never half.

**Keep it short.** Tailwind's README is 4 sections. shadcn/ui's is 5. Both are among the highest-starred repos on GitHub. A short README is a confident README when the depth lives on a docs site.

## 5. Repo settings, all UI only

- [ ] Description and website filled in
- [ ] **Social preview image** uploaded, 1280x640, under 1MB. Otherwise every share renders GitHub's generic card.
- [ ] **8 to 12 topics.** Find them by looking at what 3 similar repos use, not by inventing them.
- [ ] Wiki off, Projects off unless used
- [ ] Discussions **off until there is traffic**. An empty Discussions tab is worse than no tab.
- [ ] Squash merge only, with the commit message default set to "Pull request title and description"
- [ ] Auto-delete head branches on
- [ ] **Private vulnerability reporting: enable.** Not on by default even in 2026, one click, and it is what makes `/security/advisories/new` work.
- [ ] Secret scanning and push protection: confirm on (free and default for public repos)
- [ ] **Immutable releases: enable.** GA since October 2025.
- [ ] Branch ruleset on the default branch: block force push, block deletion, require PR, require status checks, add yourself to the bypass list if solo
- [ ] Labels created to match whatever the issue forms and `release.yml` reference

## 6. Release automation

- [ ] Conventional Commits, enforced two ways: a local `commit-msg` hook in `.githooks` (contributors opt in with `git config core.hooksPath .githooks`), and a CI job that lints the **pull request title**, because squash-merge makes the title the commit on the default branch.
- [ ] release-please with `changelog-sections` mapping each commit type to an emoji section. This is one place emoji land well: they make a long changelog scannable.
- [ ] Attach build artifacts to the release.
- [ ] `actions/attest-build-provenance` on the release job once the project has real users. Free for public repos, and it lets anyone run `gh attestation verify <file> --repo OWNER/REPO`.

## 7. Testing and coverage

- [ ] CI runs typecheck, unit tests, build, and at least one end-to-end test against the real runtime.
- [ ] **Do not add a coverage badge.** It is now a minority signal, 3 of 30 surveyed repos. Set a coverage floor instead, so a regression fails CI:

```toml
# bunfig.toml
[test]
coverageThreshold = { lines = 0.75, functions = 0.70, statements = 0.75 }
```

Start the floor just below your current number and ratchet it up. That is the actual engineering benefit; the badge was only ever the advertisement for it. If you do want the badge, use a shields.io endpoint fed by a JSON file on an orphan `badges` branch: no account, no third-party action, no token beyond the built-in one. See `.github/workflows/coverage-badge.yml`.

## 8. Dependencies

- [ ] **Dependabot, not Renovate**, unless you have a monorepo, a non-GitHub forge, or more than a couple of package ecosystems. Renovate's historic advantages (grouping, scheduling, cooldowns) all landed in Dependabot during 2025, and a 3-day cooldown became the zero-config default in July 2026.
- [ ] Group updates so you get one PR a week, not seven.
- [ ] Set a longer cooldown on majors: `semver-major-days: 14`.

## 9. The 10-minute version

If you only have ten minutes on a repo, do these, in order. They are roughly 80% of the perceived professionalism:

1. Repo description, website, and 10 topics
2. Social preview image
3. Badge row and a hero image on the README
4. `SECURITY.md` plus enable private vulnerability reporting
5. `dependabot.yml`

## 10. What not to bother with

Verified as absent from every well-regarded repo surveyed in 2026: all-contributors bot tables, contrib.rocks contributor mosaics, "made with love" footers, visitor and hit counters, share-on-social badge rows, long PR checklists, markdown-format issue templates (forms won), and roadmap sections inside the README (those moved to pinned issues or the docs site).

Also skip, for a small repo specifically: `harden-runner` (defends an attack surface you do not have until a workflow holds a publishing credential), Immutable Actions (only relevant if you publish an action), and the OpenSSF Best Practices self-attestation questionnaire (redundant with Scorecard). OpenSSF Scorecard itself is worth running privately, but be aware a solo maintainer is structurally capped near 7 because the Code-Review and Contributors checks both score 0 by definition, so think twice before publishing the badge.
