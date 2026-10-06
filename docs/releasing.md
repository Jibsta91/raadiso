# Versioning and releases

## Versions

Raadi follows [Semantic Versioning](https://semver.org/). Until the first production release (end of
Phase 6) the major version is 0:

| Version          | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `v0.N.0`         | Phase N is done (every phase gate green; see [roadmap](roadmap.md)) |
| `v0.N.0-alpha.M` | A merged slice of a phase that is still in progress                 |
| `v0.N.P`         | A fix on top of a finished phase                                    |
| `v1.0.0`         | First production release; from then on SemVer applies to the APIs   |

The tag is the only source of the version. `RAADI_VERSION=dev` in `.env` marks local builds.

## Tags

- Tags are **annotated and signed** (`git tag -s`, the same SSH key as commits), named `vX.Y.Z` or
  `vX.Y.Z-alpha.N`, and placed only on commits on `main` whose gates pass
  (run locally while GitHub Actions are switched off).
- A tag ruleset protects `v*`: tags cannot be moved, deleted or created unsigned. A broken release gets a
  new version, never a moved tag.
- Each tag has a **GitHub Release**. Pre-releases (`-alpha.N`) are marked as such. The notes are generated
  from the merged pull requests and grouped by label (`.github/release.yml`), and `CHANGELOG.md` summarises
  them for people.

## Making a release

```bash
git switch main && git pull --ff-only
# check that the gates pass for HEAD (locally while GitHub Actions are off), then:
git tag -s v0.3.0-alpha.2 -m "v0.3.0-alpha.2: <one-line summary>"
git push origin v0.3.0-alpha.2
# then create the GitHub Release from the tag (generated notes), and add the entry to CHANGELOG.md
```

## Container images (Phase 5)

The release workflow builds multi-arch images to GHCR from the tag and pushes them as:

- `ghcr.io/<owner>/raadi-<service>:X.Y.Z` (immutable)
- `:X.Y`, a moving tag for the newest patch of a minor version (convenience only)
- `:sha-<12-char commit>`, which traces an image back to its commit

They are signed with Cosign and have an SBOM and SLSA provenance. Deployments reference the image
**by digest** (`@sha256:…`), pinned in the deployed configuration. `latest` is never published or used
([ADR-0010](adr/0010-pinned-versions.md)).
