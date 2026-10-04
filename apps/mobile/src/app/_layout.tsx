import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider, useI18n } from '../i18n';
import { AuthProvider } from '../lib/auth/provider';
import { PushRegistration } from '../lib/push';
import { RealtimeProvider } from '../lib/realtime';
import { glassBar, liquidGlass } from '../components/ui';
import { fonts, ThemeProvider, useTheme } from '../theme';

/**
 * Last-resort error screen for anything that throws while rendering. Self-contained (no theme or i18n
 * providers, which may be what failed). In development the full stack goes to the console, which Expo Go
 * forwards to Metro's log.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    // eslint-disable-next-line no-console -- the only way an error on a phone reaches Metro's log
    console.error(`Render error: ${error.message}\n${error.stack ?? '(no stack)'}`);
  }, [error]);
  return (
    <View
      testID="error-boundary"
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        backgroundColor: '#f3f4f7',
      }}
    >
      <Text style={{ fontSize: 28, fontWeight: '800', color: '#0e1116' }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 16, color: '#5b6170' }}>{error.message}</Text>
      <Pressable
        role="button"
        onPress={() => void retry()}
        style={{
          alignSelf: 'flex-start',
          borderRadius: 999,
          backgroundColor: '#0e1116',
          paddingHorizontal: 20,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

// Deep links (a shared listing, a chat from a notification) open on top of the tabs, so Back works.
export const unstable_settings = { initialRouteName: '(tabs)' };

function Screens() {
  const theme = useTheme();
  const { m } = useI18n();
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerShadowVisible: false,
          headerTintColor: theme.text,
          headerTitleStyle: { color: theme.text, fontFamily: fonts.semibold },
          headerBackTitle: m.common.back,
          // iOS: large titles (where a screen asks for them) in the brand's display face.
          headerLargeTitleStyle: { color: theme.text, fontFamily: fonts.display },
          headerLargeTitleShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="listings/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="listings/new" options={{ title: m.sell.title }} />
        <Stack.Screen
          name="contact/[listingId]"
          options={{
            presentation: 'formSheet',
            sheetAllowedDetents: 'fitToContents',
            sheetGrabberVisible: true,
            headerShown: false,
            // iOS 26 draws sheets in Liquid Glass when the content leaves the background clear.
            contentStyle: { backgroundColor: liquidGlass ? 'transparent' : theme.background },
          }}
        />
        <Stack.Screen name="messages/[id]" options={{ title: m.messages.title }} />
        <Stack.Screen
          name="my-listings"
          options={{ title: m.account.myListings, headerLargeTitle: true, ...glassBar }}
        />
        <Stack.Screen
          name="favourites"
          options={{ title: m.favourites.title, headerLargeTitle: true, ...glassBar }}
        />
        <Stack.Screen
          name="saved-searches/index"
          options={{ title: m.savedSearches.title, headerLargeTitle: true, ...glassBar }}
        />
        <Stack.Screen name="saved-searches/[id]" options={{ title: m.savedSearches.title }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Fonts ship inside the app (OFL-1.1): nothing is fetched at runtime (ADR-0009).
  const [loaded] = useFonts({
    [fonts.body]: Geist_400Regular,
    [fonts.medium]: Geist_500Medium,
    [fonts.semibold]: Geist_600SemiBold,
    [fonts.bold]: Geist_700Bold,
    [fonts.display]: BricolageGrotesque_700Bold,
    [fonts.displayHeavy]: BricolageGrotesque_800ExtraBold,
  });
  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <RealtimeProvider>
              <Screens />
              <PushRegistration />
            </RealtimeProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
