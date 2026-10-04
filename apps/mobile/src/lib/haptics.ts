import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// Light touch feedback on the phone (nothing on the web). Failures are ignored: haptics are a bonus.
const native = Platform.OS !== 'web';

export const haptics = {
  /** A choice or toggle, e.g. a favourite. */
  tap(): void {
    if (native) void Haptics.selectionAsync().catch(() => undefined);
  },
  /** Something went through, e.g. a message was sent. */
  success(): void {
    if (native)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
  },
};
