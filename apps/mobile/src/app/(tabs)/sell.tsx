import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, LargeTitle, Status } from '../../components/ui';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth/context';
import { space, tabBarSpace } from '../../theme';
import { PickCategory } from '../listings/new';

/**
 * The Sell tab in the middle of the tab bar: the first step of a new listing (pick a category), like
 * FINN's "Ny annonse". A tab is a place, not an action (Apple's guidelines), so picking a category
 * continues in the new-listing screen at the subcategory step.
 */
export default function SellTab() {
  const { m } = useI18n();
  const auth = useAuth();
  const insets = useSafeAreaInsets();

  if (auth.status === 'loading') return <Status loading />;
  if (auth.status !== 'signedIn') {
    return (
      <View style={[styles.signedOut, { paddingTop: insets.top + space.lg }]} testID="sell-tab">
        <LargeTitle>{m.sell.title}</LargeTitle>
        <Body muted>{m.sell.signIn}</Body>
        <Button testID="sell-login" label={m.auth.login} onPress={() => void auth.signIn()} />
      </View>
    );
  }
  return (
    <PickCategory
      testID="sell-tab"
      heading={<LargeTitle>{m.sell.title}</LargeTitle>}
      contentStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: tabBarSpace + insets.bottom,
      }}
      onPick={(category) => router.push({ pathname: '/listings/new', params: { category } })}
    />
  );
}

const styles = StyleSheet.create({
  signedOut: { flex: 1, paddingHorizontal: space.lg, gap: space.lg },
});
