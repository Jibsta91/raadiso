# 0014 — Media pipeline: scan, re-encode, signed URLs, orphan GC

- Status: Accepted
- Date: 2026-10-01

## Decision

Uploads go through the **media** service (`POST /api/v1/media`, at most 10 MB) and never reach public storage
as uploaded:

1. **ClamAV** (GPL-2.0, run as a separate network service, so its licence does not affect Raadi's code)
   scans every upload over `zINSTREAM`, before anything parses it. Detections are recorded with the
   signature name whatever the file type. clamd has no authentication, so only media joins its internal
   `scan` network. If the scanner is unavailable, the upload is refused with `503`.
2. **Content sniffing** accepts only JPEG, PNG and WebP by magic bytes. The client's `Content-Type` is ignored.
3. The raw bytes are staged in the private `raadi-uploads` bucket in **SeaweedFS** (Apache-2.0, S3 API).
   **imgproxy** (MIT) re-encodes them to JPEG: auto-rotated, metadata stripped, bounded resolution. A file
   that does not decode is rejected. Only the re-encoded file is stored in `raadi-media`, and the staged
   upload is deleted.
4. The media row, an owner tuple in OpenFGA ([ADR-0013](0013-authorization.md)) and a `media.uploaded`
   event are written. Rejections are stored too, without the file, for abuse analysis.

Images are served by imgproxy behind the gateway at `/img/…` in fixed presets (`thumb`, `card`, `large`, WebP).
Every URL carries an **HMAC-SHA256 signature** (key and salt from OpenBao), so imgproxy cannot be made to fetch
or resize anything the services did not sign. Signed URLs are stable, so CDNs and browsers can cache them.
Since [ADR-0059](0059-caching-images-and-public-answers.md) an nginx cache (`img-cache`) sits between the
gateway and imgproxy: each variant is rendered once, and browsers are told it is immutable.

A listing references images by id. Listings check `can_attach` in OpenFGA (you can only attach your own
images). Media learns which listing an image belongs to from `listing.*` events. Images still unattached after
`ORPHAN_TTL_HOURS` (24 h) are deleted by a periodic job (one instance at a time, under an advisory lock).
Images of a deleted listing become unattached and are collected the same way.

## Alternatives considered

- **MinIO**: AGPL since 2021 and the community edition has been cut back. SeaweedFS covers the S3 subset we
  need.
- **Serving originals directly**: leaks EXIF data (GPS location) and serves unvalidated bytes.
- **Thumbnails generated at upload time**: fixed presets with imgproxy cost nothing up front, and new sizes
  need no backfill.

## Consequences

ClamAV is the largest new container (about 950 MB with signatures loaded; see
[ADR-0011](0011-resource-budget.md)). Signatures ship in the image so scanning works offline, and freshclam
can be disabled (`CLAMAV_FRESHCLAM=false`) on air-gapped installs. Because ClamAV's EICAR signature is
anchored at offset 0, the smoke test sends the plain EICAR file, which is scanned before its type is checked.
