import { useLocalSearchParams } from 'expo-router';
import { Status } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { unwrap, useApi, useLoad } from '../../../lib/api';
import { useAuth } from '../../../lib/auth/context';
import { isCategory, type SubcategoryId } from '../../../lib/categories';
import { ListingForm } from '../new';

/** Edit a listing (owner; listings decides with OpenFGA, ADR-0013), like the website's edit page. */
export default function EditListing() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const listing = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(await api.listings.GET('/api/v1/listings/{id}', { params: { path: { id } } }))
        : undefined,
    [api, id, auth.status],
  );
  const item = listing.data;
  if (!item || !item.viewer?.canEdit || !isCategory(item.category)) {
    return (
      <Status
        loading={listing.loading || auth.status === 'loading'}
        error={listing.error}
        empty={m.listing.notFound}
        onRetry={listing.reload}
      />
    );
  }
  return (
    <ListingForm
      category={item.category}
      subcategory={item.subcategory as SubcategoryId}
      existing={item}
    />
  );
}
