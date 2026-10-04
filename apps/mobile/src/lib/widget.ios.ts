import { APP_GROUP, type WidgetPayload } from './widget-payload';

type Storage = { set(key: string, value: string): void };

// The widget's native module is only in builds that include the widget (targets/widget); in other
// builds the app carries on without it.
let storage: Storage | undefined;
let reload: (() => void) | undefined;
try {
  const { ExtensionStorage } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@bacons/apple-targets') as typeof import('@bacons/apple-targets');
  storage = new ExtensionStorage(APP_GROUP);
  reload = () => ExtensionStorage.reloadWidget('SavedSearches');
} catch {
  storage = undefined;
}

/** Hands the widget its data through the shared App Group and asks iOS to redraw it. */
export function updateWidget(payload: WidgetPayload): void {
  if (!storage) return;
  try {
    storage.set('widget', JSON.stringify(payload));
    reload?.();
  } catch {
    // A widget that cannot update keeps showing its last data.
  }
}
