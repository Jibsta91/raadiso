import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import { parseEvent } from '@raadi/events';
import { FgaClient, imageUrls, type ImgproxySigner, type Principal } from '@raadi/service-kit';
import { PermanentEventError, type ReceivedEvent } from '@raadi/service-kit/kafka';
import { ClamAvScanner, ScannerUnavailableError } from './clamav.js';
import { ImageSanitizer, InvalidImageError, sniffImageType } from './imaging.js';
import { MediaRepository, type MediaRow, type RejectionReason } from './media.repository.js';
import { MediaStorage } from './storage.js';

export const SIGNER = Symbol('IMGPROXY_SIGNER');

const meter = metrics.getMeter('media');
const uploads = meter.createCounter('raadi.media.uploads', {
  description:
    'Image uploads by outcome (ready, malware, unsupported_type, invalid_image, too_large)',
});
const uploadBytes = meter.createHistogram('raadi.media.upload.size', {
  description: 'Size of accepted uploads after re-encoding',
  unit: 'By',
});
const garbageCollected = meter.createCounter('raadi.media.orphans_deleted', {
  description: 'Unattached images deleted after the TTL',
});

export interface MediaView {
  id: string;
  status: 'ready';
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  listingId: string | null;
  createdAt: string;
  urls: { thumb: string; card: string; large: string };
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly repo: MediaRepository,
    private readonly storage: MediaStorage,
    private readonly scanner: ClamAvScanner,
    private readonly sanitizer: ImageSanitizer,
    private readonly fga: FgaClient,
    @Inject(SIGNER) private readonly signer: ImgproxySigner,
  ) {}

  view(row: MediaRow): MediaView {
    return {
      id: row.id,
      status: 'ready',
      contentType: row.content_type,
      bytes: row.bytes,
      width: row.width!,
      height: row.height!,
      listingId: row.listing_id,
      createdAt: row.created_at.toISOString(),
      urls: imageUrls(this.signer, row.id, { bucket: this.storage.mediaBucket }),
    };
  }

  /**
   * Upload pipeline: ClamAV (every upload, so detections are recorded
   * whatever the file type) → sniff the real type → stage the raw bytes →
   * imgproxy re-encode (proves it decodes, strips metadata, bounds size) →
   * store the result → record it with an event and an OpenFGA owner tuple.
   * The raw upload never becomes publicly reachable.
   */
  async upload(principal: Principal, data: Buffer): Promise<MediaView> {
    const id = randomUUID();
    const sha256 = createHash('sha256').update(data).digest('hex');
    trace
      .getActiveSpan()
      ?.setAttributes({ 'raadi.media.id': id, 'raadi.media.bytes': data.length });

    let verdict;
    try {
      verdict = await this.scanner.scan(data);
    } catch (error) {
      if (error instanceof ScannerUnavailableError) {
        uploads.add(1, { outcome: 'scanner_unavailable' });
        throw new ServiceUnavailableException(
          'Virus scanning is temporarily unavailable; please retry.',
        );
      }
      throw error;
    }
    const type = sniffImageType(data);
    if (!verdict.clean)
      return this.reject(
        principal,
        id,
        data,
        sha256,
        type ?? 'application/octet-stream',
        'malware',
        verdict.signature,
      );
    if (!type)
      return this.reject(
        principal,
        id,
        data,
        sha256,
        'application/octet-stream',
        'unsupported_type',
      );

    await this.storage.put(this.storage.uploadBucket, id, data, type);
    let sanitized;
    try {
      sanitized = await this.sanitizer.sanitize(`s3://${this.storage.uploadBucket}/${id}`);
    } catch (error) {
      if (error instanceof InvalidImageError)
        return this.reject(principal, id, data, sha256, type, 'invalid_image');
      throw error;
    } finally {
      await this.storage.delete(this.storage.uploadBucket, id).catch(() => undefined);
    }

    await this.storage.put(this.storage.mediaBucket, id, sanitized.data, 'image/jpeg');
    const row = await this.repo.createReady(
      {
        id,
        ownerId: principal.sub,
        contentType: 'image/jpeg',
        bytes: sanitized.data.length,
        width: sanitized.width,
        height: sanitized.height,
        sha256,
      },
      () =>
        this.fga.write([
          { user: `user:${principal.sub}`, relation: 'owner', object: `media:${id}` },
        ]),
    );
    uploads.add(1, { outcome: 'ready' });
    uploadBytes.record(sanitized.data.length);
    return this.view(row!);
  }

  async get(principal: Principal, id: string): Promise<MediaView> {
    const row = await this.repo.findById(id);
    if (!row || row.status !== 'ready') throw new NotFoundException('Image not found');
    if (row.owner_id !== principal.sub) throw new ForbiddenException('Not your image');
    return this.view(row);
  }

  /** Owners may delete images that are not attached to a listing (edit the listing first). */
  async remove(principal: Principal, id: string): Promise<void> {
    const row = await this.repo.findById(id);
    if (!row || row.status !== 'ready') throw new NotFoundException('Image not found');
    if (row.owner_id !== principal.sub) throw new ForbiddenException('Not your image');
    if (row.listing_id)
      throw new ConflictException('The image is used by a listing; remove it there first');
    await this.purge(row);
  }

  /** Kafka handler for raadi.listing.events: keeps image attachments in sync. */
  async onListingEvent(event: ReceivedEvent): Promise<void> {
    let parsed;
    try {
      parsed = parseEvent(event.value);
    } catch (error) {
      throw new PermanentEventError('listing event violates its contract', { cause: error });
    }
    if (!parsed) return; // a newer event type this build does not know
    switch (parsed.type) {
      case 'no.raadi.listings.listing.published.v1':
      case 'no.raadi.listings.listing.updated.v1': {
        const { listing } = parsed.data;
        await this.repo.syncListingImages(
          parsed.id,
          listing.id,
          listing.version,
          listing.status === 'deleted'
            ? null
            : { ownerId: listing.ownerId, imageIds: listing.imageIds },
        );
        return;
      }
      case 'no.raadi.listings.listing.deleted.v1':
        // Detached images become orphans and are garbage-collected after the TTL.
        await this.repo.syncListingImages(
          parsed.id,
          parsed.data.listingId,
          parsed.data.version,
          null,
        );
        return;
      default:
        return;
    }
  }

  /** Deletes unattached images older than the TTL (one instance at a time). */
  async collectOrphans(ttlHours: number): Promise<number> {
    let deleted = 0;
    await this.repo.withAdvisoryLock(0x6d65646961, async () => {
      for (const row of await this.repo.orphans(ttlHours)) {
        await this.purge(row);
        deleted++;
      }
    });
    if (deleted) {
      garbageCollected.add(deleted);
      this.logger.log({ deleted }, 'deleted unattached images');
    }
    return deleted;
  }

  private async purge(row: MediaRow): Promise<void> {
    if (!(await this.repo.markDeleted(row.id))) return;
    await this.storage.delete(this.storage.mediaBucket, row.id);
    await this.fga
      .write([], [{ user: `user:${row.owner_id}`, relation: 'owner', object: `media:${row.id}` }])
      .catch((err: unknown) =>
        this.logger.warn({ err, mediaId: row.id }, 'owner tuple not removed'),
      );
  }

  private async reject(
    principal: Principal,
    id: string,
    data: Buffer,
    sha256: string,
    contentType: string,
    reason: RejectionReason,
    signature?: string,
  ): Promise<never> {
    uploads.add(1, { outcome: reason });
    await this.repo.createRejected({
      id,
      ownerId: principal.sub,
      contentType,
      bytes: data.length,
      sha256,
      reason,
      signature,
    });
    if (reason === 'malware') {
      this.logger.warn(
        { mediaId: id, signature, userId: principal.sub },
        'upload rejected: malware',
      );
    }
    const detail: Record<RejectionReason, string> = {
      malware: 'The file was rejected by the virus scanner.',
      unsupported_type: 'Only JPEG, PNG and WebP images are accepted.',
      invalid_image: 'The file could not be read as an image.',
      too_large: 'The file is too large.',
    };
    throw new UnprocessableEntityException({
      message: detail[reason],
      errors: [{ path: 'file', message: detail[reason], code: reason }],
    });
  }
}
