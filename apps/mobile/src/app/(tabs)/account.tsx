import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented } from '../../components/segmented';
import { Body, Button, LargeTitle, Status, Title } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { languageNames } from '../../i18n/messages';
import { unwrap, useApi, useLoad } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import { config } from '../../lib/config';
import { APP_LOCALES } from '../../lib/country';
import {
  fonts,
  radius,
  space,
  tabBarSpace,
  useTheme,
  useThemeState,
  type ThemePreference,
} from '../../theme';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

/** Push for new messages (ADR-0025). Other pushes follow the in-app notices and cannot be muted. */
function NotificationSettings() {
  const { m } = useI18n();
  const api = useApi();
  const theme = useTheme();
  const prefs = useLoad(
    async () => unwrap(await api.notifications.GET('/api/v1/notifications/preferences')),
    [api],
  );
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState<boolean>();
  const value = override ?? prefs.data?.pushMessages ?? true;

  const toggle = async (next: boolean) => {
    if (!prefs.data) return;
    setOverride(next);
    setSaving(true);
    const { response } = await api.notifications
      .PUT('/api/v1/notifications/preferences', {
        body: { emailMessages: prefs.data.emailMessages, pushMessages: next },
      })
      .catch(() => ({ response: { ok: false } }));
    if (!response.ok) setOverride(!next);
    setSaving(false);
  };

  return (
    <View style={styles.section}>
      <Title>{m.account.notifications}</Title>
      <View style={[styles.row, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.rowText, { color: theme.text }]}>{m.account.pushMessages}</Text>
        <Switch
          testID="push-messages"
          accessibilityLabel={m.account.pushMessages}
          value={value}
          disabled={!prefs.data || saving}
          onValueChange={(next) => void toggle(next)}
          trackColor={{ true: theme.accent }}
        />
      </View>
      <Body muted style={styles.hint}>
        {m.account.pushHint}
      </Body>
    </View>
  );
}

export default function Account() {
  const { m, locale, setLocale } = useI18n();
  const { preference, setPreference } = useThemeState();
  const auth = useAuth();
  const api = useApi();
  const insets = useSafeAreaInsets();
  // Refreshed whenever the tab comes back into view, so the count follows what was read.
  const unread = useLoad(
    async () =>
      auth.status === 'signedIn'
        ? unwrap(await api.notifications.GET('/api/v1/notifications/unread'))
        : undefined,
    [api, auth.status],
  );
  const reloadUnread = unread.reload;
  useFocusEffect(useCallback(() => reloadUnread(), [reloadUnread]));
  if (auth.status === 'loading') return <Status loading />;

  const themeLabels: Record<ThemePreference, string> = {
    system: m.account.themeSystem,
    light: m.account.themeLight,
    dark: m.account.themeDark,
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + space.lg, paddingBottom: tabBarSpace + insets.bottom },
      ]}
    >
      <LargeTitle>{m.account.title}</LargeTitle>
      {auth.status === 'signedIn' && auth.user ? (
        <View style={styles.section}>
          <Body testID="signed-in-as">
            {fill(m.auth.signedInAs, { email: auth.user.email ?? auth.user.name ?? '' })}
          </Body>
          <Button
            testID="account-new-listing"
            variant="ink"
            label={m.sell.title}
            onPress={() => router.push('/listings/new')}
          />
          <Button
            testID="open-notifications"
            variant="secondary"
            label={
              unread.data?.count
                ? `${m.notifications.title} · ${fill(m.notifications.unread, { count: unread.data.count })}`
                : m.notifications.title
            }
            onPress={() => router.push('/notifications')}
          />
          <Button
            testID="my-listings"
            variant="secondary"
            label={m.account.myListings}
            onPress={() => router.push('/my-listings')}
          />
          <Button
            testID="favourites"
            variant="secondary"
            label={m.favourites.title}
            onPress={() => router.push('/favourites')}
          />
          <Button
            testID="saved-searches"
            variant="secondary"
            label={m.savedSearches.title}
            onPress={() => router.push('/saved-searches')}
          />
          <Button
            testID="reviews"
            variant="secondary"
            label={m.reviewsPage.title}
            onPress={() => router.push('/reviews')}
          />
          <Button
            testID="open-my-profile"
            variant="secondary"
            label={m.profile.myProfile}
            onPress={() => router.push(`/users/${auth.user!.id}`)}
          />
          <Button
            testID="logout"
            variant="secondary"
            label={m.auth.logout}
            onPress={() => void auth.signOut()}
          />
        </View>
      ) : (
        <View style={styles.section}>
          {auth.error ? <Body muted>{m.auth.failed}</Body> : null}
          <Button testID="login" label={m.auth.login} onPress={() => void auth.signIn()} />
        </View>
      )}

      {auth.status === 'signedIn' && Platform.OS !== 'web' ? <NotificationSettings /> : null}

      <View style={styles.section}>
        <Title>{m.account.appearance}</Title>
        <Segmented
          testID="theme"
          label={m.account.appearance}
          value={preference}
          onChange={setPreference}
          options={THEMES.map((t) => ({ value: t, label: themeLabels[t] }))}
        />
      </View>

      <View style={styles.section}>
        <Title>{m.account.language}</Title>
        <Segmented
          testID="locale"
          label={m.account.language}
          value={locale}
          onChange={(next) => {
            setLocale(next);
            // Signed in: save it to the profile too, so e-mails and pushes use it.
            if (auth.status === 'signedIn') {
              void auth
                .fetch(
                  new Request(`${config.apiBaseUrl}/api/v1/identity/me`, {
                    method: 'PATCH',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ locale: next }),
                  }),
                )
                .catch(() => undefined);
            }
          }}
          options={APP_LOCALES.map((l) => ({ value: l, label: languageNames[l] }))}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: space.xl - 4, gap: space.xxl },
  section: { gap: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  rowText: { flex: 1, fontFamily: fonts.medium, fontSize: 16 },
  hint: { fontSize: 14, lineHeight: 20 },
});
