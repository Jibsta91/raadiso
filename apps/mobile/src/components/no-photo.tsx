import { Icon } from './icon';
import { View } from 'react-native';
import { CATEGORY_ICONS, isCategory } from '../lib/categories';
import { useTheme } from '../theme';

/**
 * Stand-in for a listing without photos: the category's icon on the placeholder colour, or a
 * generic image icon when the category is unknown (conversations don't carry it). `style` is one
 * object, never an array (see listing-card.tsx).
 */
export function NoPhoto({
  category,
  size = 32,
  style,
}: {
  category?: string;
  size?: number;
  style: object;
}) {
  const theme = useTheme();
  return (
    <View
      testID="no-photo"
      style={{
        ...style,
        backgroundColor: theme.placeholder,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon
        name={isCategory(category) ? CATEGORY_ICONS[category] : 'image-outline'}
        size={size}
        color={theme.muted}
        aria-hidden
      />
    </View>
  );
}
