import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContactCompose } from '../../components/contact-compose';
import { Body } from '../../components/ui';
import { useI18n } from '../../i18n';
import { fonts, space, useTheme } from '../../theme';

/**
 * Contact the seller, as a native iOS sheet (presented by the root stack as a form sheet with a
 * grabber). After sending, the sheet closes and the new conversation opens.
 */
export default function ContactSheet() {
  const { listingId, title } = useLocalSearchParams<{ listingId: string; title?: string }>();
  const { m } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}
      testID="contact-sheet"
    >
      <View style={styles.head}>
        <Text role="heading" style={[styles.title, { color: theme.text }]}>
          {m.contact.title}
        </Text>
        {title ? <Body muted>{title}</Body> : null}
      </View>
      <ContactCompose
        listingId={listingId}
        onCancel={() => router.back()}
        onSent={(conversation) => {
          router.back();
          router.push(`/messages/${conversation}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.lg },
  head: { gap: space.xs },
  title: { fontFamily: fonts.display, fontSize: 22 },
});
