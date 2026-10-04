import { FlatList, StyleSheet } from 'react-native';
import { ListingTile } from '../components/listing-card';
import { Status } from '../components/ui';
import { useI18n } from '../i18n';
import { unwrap, useApi, usePaged } from '../lib/api';
import { useAuth } from '../lib/auth/context';
import { space } from '../theme';

const PAGE_SIZE = 48;

/** The signed-in user's favourites (ADR-0026); sold ones stay, marked sold. */
export default function Favourites() {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const favourites = usePaged(
    async (offset) =>
      auth.status === 'signedIn'
        ? unwrap(
            await api.saved.GET('/api/v1/saved/favourites', {
              params: { query: { limit: PAGE_SIZE, offset } },
            }),
          )
        : undefined,
    [api, auth.status],
  );

  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      testID="favourites"
      contentContainerStyle={styles.list}
      data={favourites.items}
      numColumns={2}
      columnWrapperStyle={styles.row}
      keyExtractor={(f) => f.listingId}
      renderItem={({ item }) => (
        <ListingTile
          hit={{
            id: item.listing.id,
            title: item.listing.title,
            priceNok: item.listing.priceNok,
            category: item.listing.category,
            image: item.listing.image,
            location: item.listing.location,
            sold: item.listing.status === 'sold',
          }}
        />
      )}
      onEndReached={favourites.more}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Status
          loading={favourites.loading && favourites.items.length === 0}
          error={favourites.error}
          empty={m.favourites.empty}
          onRetry={favourites.reload}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl - 4, flexGrow: 1 },
  row: { gap: space.md + 2, marginBottom: space.lg },
});
