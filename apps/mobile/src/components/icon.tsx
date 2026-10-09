import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform } from 'react-native';

export type IconName = keyof typeof Ionicons.glyphMap;

// The app names its icons after Ionicons; on iOS each one is drawn as the closest SF Symbol, so icons
// match the system's (weights, optical sizes, the tab bar). Names without a symbol stay Ionicons.
const SF_SYMBOLS: Partial<Record<IconName, SFSymbol>> = {
  add: 'plus',
  'airplane-outline': 'airplane',
  'arrow-up': 'arrow.up',
  'bag-handle-outline': 'bag',
  'ban-outline': 'nosign',
  'bed-outline': 'bed.double',
  'bicycle-outline': 'bicycle',
  'bonfire-outline': 'flame',
  'bookmark-outline': 'bookmark',
  'briefcase-outline': 'briefcase',
  'build-outline': 'wrench.adjustable',
  'bus-outline': 'bus',
  'business-outline': 'building.2',
  'camera-outline': 'camera',
  'car-outline': 'car',
  'car-sport-outline': 'car.side',
  'cart-outline': 'cart',
  'chatbubble-ellipses-outline': 'ellipsis.bubble',
  chatbubbles: 'bubble.left.and.bubble.right.fill',
  'chatbubbles-outline': 'bubble.left.and.bubble.right',
  'chevron-back': 'chevron.backward',
  'chevron-forward': 'chevron.forward',
  close: 'xmark',
  'color-palette-outline': 'paintpalette',
  'construct-outline': 'wrench.and.screwdriver',
  'create-outline': 'square.and.pencil',
  'earth-outline': 'globe.europe.africa',
  'ellipse-outline': 'circle',
  'hammer-outline': 'hammer',
  'grid-outline': 'square.grid.2x2',
  'happy-outline': 'face.smiling',
  heart: 'heart.fill',
  'heart-outline': 'heart',
  home: 'house.fill',
  'home-outline': 'house',
  'image-outline': 'photo',
  'images-outline': 'photo.on.rectangle',
  'key-outline': 'key',
  'laptop-outline': 'laptopcomputer',
  'leaf-outline': 'leaf',
  'list-outline': 'list.bullet',
  'location-outline': 'mappin.and.ellipse',
  'mail-open-outline': 'envelope.open',
  'map-outline': 'map',
  'medkit-outline': 'cross.case',
  'musical-notes-outline': 'music.note.list',
  'paw-outline': 'pawprint',
  'person-circle': 'person.crop.circle.fill',
  'person-circle-outline': 'person.crop.circle',
  'phone-portrait-outline': 'iphone',
  'pricetag-outline': 'tag',
  'restaurant-outline': 'fork.knife',
  'school-outline': 'graduationcap',
  search: 'magnifyingglass',
  'search-outline': 'magnifyingglass',
  'share-outline': 'square.and.arrow.up',
  'shield-outline': 'shield',
  'shirt-outline': 'tshirt',
  'speedometer-outline': 'speedometer',
  star: 'star.fill',
  'star-outline': 'star',
  'trail-sign-outline': 'signpost.right',
  'trash-outline': 'trash',
};

export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  // Decorative: the button or row around an icon carries the label for VoiceOver.
  const fallback = <Ionicons name={name} size={size} color={color} aria-hidden />;
  const symbol = Platform.OS === 'ios' ? SF_SYMBOLS[name] : undefined;
  if (!symbol) return fallback;
  return (
    <SymbolView
      name={symbol}
      size={size}
      tintColor={color}
      resizeMode="scaleAspectFit"
      style={{ width: size, height: size }}
      fallback={fallback}
      accessible={false}
      aria-hidden
    />
  );
}
