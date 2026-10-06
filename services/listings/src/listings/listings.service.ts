import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { metrics, trace } from '@opentelemetry/api';
import {
  displayName,
  FgaClient,
  OpaClient,
  type ImgproxySigner,
  type Principal,
  type TupleKey,
} from '@raadi/service-kit';
import {
  type CreateListing,
  type Listing,
  type ListingRow,
  mergedListingSchema,
  toListing,
  type UpdateListing,
} from './listing.model.js';
import { ListingsRepository, VersionConflictError } from './listings.repository.js';

export interface ListingContact {
  listingId: string;
  ownerId: string;
  sellerName: string;
  title: string;
  status: 'active' | 'sold';
  imageId: string | null;
}

export const SIGNER = Symbol('IMGPROXY_SIGNER');

const meter = metrics.getMeter('listings');
const listingsWritten = meter.createCounter('raadi.listings.written', {
  description: 'Listing writes by action and category',
});
const policyDenials = meter.createCounter('raadi.listings.policy_denied', {
  description: 'Listing writes denied by OPA, by reason',
});

const ownerTuples = (listingId: string, ownerId: string): TupleKey[] => [
  { user: `user:${ownerId}`, relation: 'owner', object: `listing:${listingId}` },
  { user: 'platform:raadi', relation: 'platform', object: `listing:${listingId}` },
];

@Injectable()
export class ListingsService {
  constructor(
    private readonly repo: ListingsRepository,
    private readonly fga: FgaClient,
    private readonly opa: OpaClient,
    @Inject(SIGNER) private readonly signer: ImgproxySigner,
  ) {}

  /** Public view; owners and moderators also see sold-out and removed listings' details. */
  async get(id: string, principal?: Principal): Promise<Listing> {
    const row = await this.repo.findById(id);
    if (!row) throw new NotFoundException('Listing not found');
    const viewer = principal ? await this.viewerFor(row, principal) : undefined;
    if (row.status === 'deleted' && !viewer?.canDelete)
      throw new NotFoundException('Listing not found');
    return { ...toListing(row, this.signer), ...(viewer ? { viewer } : {}) };
  }

  /** Internal: the seller to contact about a listing. Deleted listings are not found. */
  async contact(id: string): Promise<ListingContact> {
    const row = await this.repo.findById(id);
    if (!row || row.status === 'deleted') throw new NotFoundException('Listing not found');
    return {
      listingId: row.id,
      ownerId: row.owner_id,
      sellerName: row.seller_name,
      title: row.title,
      status: row.status,
      imageId: row.image_ids[0] ?? null,
    };
  }

  async mine(principal: Principal, limit: number, offset: number, withRemoved = false) {
    const { rows, total } = await this.repo.listByOwner(principal.sub, limit, offset, withRemoved);
    return { total, limit, offset, items: rows.map((r) => toListing(r, this.signer)) };
  }

  async create(principal: Principal, input: CreateListing): Promise<Listing> {
    await this.assertImagesAttachable(principal, input.imageIds);
    await this.assertPolicy('create', principal, input, await this.repo.countActive(principal.sub));

    const id = randomUUID();
    const row = await this.repo.create(
      { ...input, id, ownerId: principal.sub, sellerName: displayName(principal.claims) },
      // Written inside the transaction: if OpenFGA is down, the listing is not created.
      () => this.fga.write(ownerTuples(id, principal.sub)),
    );
    if (!row) throw new Error('listing id collision');
    listingsWritten.add(1, { action: 'create', category: row.category });
    trace.getActiveSpan()?.setAttribute('raadi.listing.id', row.id);
    return {
      ...toListing(row, this.signer),
      viewer: { isOwner: true, canEdit: true, canDelete: true },
    };
  }

  async update(
    principal: Principal,
    id: string,
    patch: UpdateListing,
    ifMatch?: number,
  ): Promise<Listing> {
    const current = await this.repo.findById(id);
    if (!current || current.status === 'deleted') throw new NotFoundException('Listing not found');
    if (!(await this.can(principal, 'can_edit', id)))
      throw new ForbiddenException('You cannot edit this listing');
    if (ifMatch !== undefined && ifMatch !== current.version) {
      throw new PreconditionFailedException(`Listing is at version ${current.version}`);
    }

    const merged = mergedListingSchema.safeParse({
      category: patch.category ?? current.category,
      subcategory: patch.subcategory ?? current.subcategory,
      title: patch.title ?? current.title,
      description: patch.description ?? current.description,
      priceNok:
        patch.priceNok !== undefined
          ? patch.priceNok
          : current.price_nok === null
            ? null
            : Number(current.price_nok),
      attributes: patch.attributes ?? current.attributes,
      placeId: patch.placeId ?? current.place_id,
      imageIds: patch.imageIds ?? current.image_ids,
    });
    if (!merged.success) {
      throw new UnprocessableEntityException({
        message: 'The listing would be invalid after this change',
        errors: merged.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const next = merged.data as CreateListing;
    const added = next.imageIds.filter((img) => !current.image_ids.includes(img));
    await this.assertImagesAttachable(principal, added);
    await this.assertPolicy('update', principal, next, 0);

    try {
      const row = await this.repo.update(id, current.version, {
        ...next,
        status: patch.status ?? current.status,
      });
      listingsWritten.add(1, { action: 'update', category: row.category });
      return { ...toListing(row, this.signer), viewer: await this.viewerFor(row, principal) };
    } catch (error) {
      if (error instanceof VersionConflictError) {
        throw new PreconditionFailedException(
          'The listing was changed by someone else; reload and try again',
        );
      }
      throw error;
    }
  }

  async remove(principal: Principal, id: string): Promise<void> {
    const current = await this.repo.findById(id);
    if (!current || current.status === 'deleted') throw new NotFoundException('Listing not found');
    if (!(await this.can(principal, 'can_delete', id)))
      throw new ForbiddenException('You cannot delete this listing');
    // The public API is the owner's. Moderators remove listings in the console, with a reason and an
    // audit entry (/admin/v1/listings/:id/remove, ADR-0030), so staff roles grant nothing here.
    await this.repo.softDelete(id, 'owner');
    listingsWritten.add(1, { action: 'delete', category: current.category });
  }

  private async viewerFor(row: ListingRow, principal: Principal) {
    const [canEdit, canDelete] = await this.fga.checkAll([
      { user: `user:${principal.sub}`, relation: 'can_edit', object: `listing:${row.id}` },
      { user: `user:${principal.sub}`, relation: 'can_delete', object: `listing:${row.id}` },
    ]);
    return { isOwner: row.owner_id === principal.sub, canEdit: canEdit!, canDelete: canDelete! };
  }

  private can(principal: Principal, relation: string, listingId: string): Promise<boolean> {
    return this.fga.check({
      user: `user:${principal.sub}`,
      relation,
      object: `listing:${listingId}`,
    });
  }

  /** Only images the caller uploaded (and that passed scanning) may be attached. */
  private async assertImagesAttachable(principal: Principal, imageIds: string[]): Promise<void> {
    const allowed = await this.fga.checkAll(
      imageIds.map((id) => ({
        user: `user:${principal.sub}`,
        relation: 'can_attach',
        object: `media:${id}`,
      })),
    );
    const refused = imageIds.filter((_, i) => !allowed[i]);
    if (refused.length) {
      throw new UnprocessableEntityException({
        message: 'Some images cannot be attached',
        errors: refused.map((id) => ({
          path: 'imageIds',
          message: `image ${id} is not yours or not ready`,
        })),
      });
    }
  }

  private async assertPolicy(
    action: 'create' | 'update',
    principal: Principal,
    listing: CreateListing,
    activeListings: number,
  ): Promise<void> {
    const decision = await this.opa.decide('raadi/listings/decision', {
      action,
      principal: { sub: principal.sub, roles: principal.roles },
      listing: {
        category: listing.category,
        subcategory: listing.subcategory,
        title: listing.title,
        description: listing.description,
        priceNok: listing.priceNok,
        imageCount: listing.imageIds.length,
      },
      context: { activeListings },
    });
    if (!decision.allow) {
      for (const reason of decision.reasons) policyDenials.add(1, { reason });
      throw new UnprocessableEntityException({
        message: 'The listing does not meet the marketplace rules',
        errors: decision.reasons.map((reason) => ({ path: '', message: reason, code: reason })),
      });
    }
  }
}
