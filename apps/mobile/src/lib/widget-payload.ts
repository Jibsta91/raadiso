/** The App Group the app and the home screen widget share (app.config.ts, targets/widget). */
export const APP_GROUP = 'group.com.raadiso.app';

/** What the "Saved searches" widget shows; written by the app, read by targets/widget. */
export interface WidgetPayload {
  title: string;
  empty: string;
  signedOut: boolean;
  signedOutText: string;
  total: number;
  items: { id: string; name: string; count: number }[];
}
