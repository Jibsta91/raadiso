import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fill, useI18n } from '../i18n';
import { Icon } from './icon';
import { fonts, radius, space } from '../theme';

/**
 * Full-screen photos (ADR-0048): swipe between them on black, pinch to zoom (iOS's zooming scroll
 * view), a strip of thumbnails to jump between them, and a close button (or Back on Android).
 */
export function PhotoViewer({
  photos,
  start,
  onClose,
}: {
  photos: { id: string; large: string; thumb: string }[];
  /** The photo to open on, or null while closed. */
  start: number | null;
  onClose: (last: number) => void;
}) {
  const { m } = useI18n();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start ?? 0);
  const list = useRef<FlatList<(typeof photos)[number]>>(null);
  const strip = useRef<ScrollView>(null);

  useEffect(() => {
    if (start !== null) setIndex(start);
  }, [start]);
  useEffect(() => {
    strip.current?.scrollTo({ x: Math.max(0, index * 60 - width / 2 + 30), animated: true });
  }, [index, width]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  const jump = (i: number) => {
    list.current?.scrollToIndex({ index: i, animated: false });
    setIndex(i);
  };

  return (
    <Modal
      visible={start !== null}
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={() => onClose(index)}
    >
      <StatusBar barStyle="light-content" />
      <View style={styles.screen} testID="photo-viewer">
        <FlatList
          ref={list}
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={start ?? 0}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={onScroll}
          keyExtractor={(p) => p.id}
          renderItem={({ item, index: i }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={styles.page}
              maximumZoomScale={4}
              minimumZoomScale={1}
              centerContent
              bouncesZoom
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: item.large }}
                style={{ width, height: height * 0.8 }}
                contentFit="contain"
                transition={120}
                accessibilityLabel={fill(m.listing.photo, { n: i + 1, total: photos.length })}
              />
            </ScrollView>
          )}
        />
        <View style={[styles.top, { top: insets.top + space.sm }]}>
          <Text style={styles.counter} testID="photo-viewer-counter">
            {index + 1} / {photos.length}
          </Text>
          <Pressable
            role="button"
            aria-label={m.common.close}
            testID="photo-viewer-close"
            hitSlop={10}
            onPress={() => onClose(index)}
            style={styles.close}
          >
            <Icon name="close" size={22} color="#ffffff" />
          </Pressable>
        </View>
        {photos.length > 1 ? (
          <ScrollView
            ref={strip}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.strip, { bottom: insets.bottom + space.md }]}
            contentContainerStyle={styles.stripContent}
          >
            {photos.map((p, i) => (
              <Pressable
                key={p.id}
                role="button"
                aria-label={fill(m.listing.photo, { n: i + 1, total: photos.length })}
                aria-selected={i === index}
                onPress={() => jump(i)}
                style={[styles.thumb, i === index ? styles.thumbOn : null]}
              >
                <Image source={{ uri: p.thumb }} style={styles.thumbImage} contentFit="cover" />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  top: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    color: '#ffffff',
    fontFamily: fonts.semibold,
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  strip: { position: 'absolute', left: 0, right: 0 },
  stripContent: { gap: 8, paddingHorizontal: space.lg },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm - 2,
    overflow: 'hidden',
    opacity: 0.55,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbOn: { opacity: 1, borderColor: '#ffffff' },
  thumbImage: { width: '100%', height: '100%' },
});
