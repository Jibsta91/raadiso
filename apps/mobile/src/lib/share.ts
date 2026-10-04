import { Share } from 'react-native';
import { config } from './config';

/** Shares the website's page for a listing: it opens for anyone, app or not. */
export function shareListing(listing: { id: string; title: string }, locale: string): void {
  const origin = config.apiBaseUrl || window.location.origin;
  void Share.share({ message: `${listing.title} — ${origin}/${locale}/listings/${listing.id}` });
}
