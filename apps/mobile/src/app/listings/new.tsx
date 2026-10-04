import { Icon, type IconName } from '../../components/icon';
import type { Media } from '@raadi/api-client';
import { ATTRIBUTE_FIELDS, attributePayload, priceRequired } from '@raadi/catalog/attributes';
import { PLACES, type Place } from '@raadi/catalog/places';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Body, Button, Chip, Field, Status, Title } from '../../components/ui';
import { fill, useI18n } from '../../i18n';
import { useApi } from '../../lib/api';
import { useAuth } from '../../lib/auth/context';
import {
  CATEGORIES,
  CATEGORY_ICONS,
  isCategory,
  SUBCATEGORY_ICONS,
  subcategoriesOf,
  type CategoryId,
  type SubcategoryId,
} from '../../lib/categories';
import { config } from '../../lib/config';
import { searchPlaces } from '../../lib/place-search';
import { absoluteUrl } from '../../lib/urls';
import { fonts, radius, space, useTheme } from '../../theme';

const MAX_PHOTOS = 10;
const POLICY = [
  'quota_exceeded',
  'price_above_ceiling',
  'prohibited_item',
  'too_many_images',
] as const;
const IMAGE = ['malware', 'unsupported_type', 'invalid_image', 'too_large'] as const;

interface Photo {
  id: string;
  thumb: string;
}

/** Sell from the app (FINN-style): category tiles, subcategory tiles, then the form. */
export default function NewListing() {
  const { m } = useI18n();
  const auth = useAuth();
  const params = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<CategoryId | undefined>(
    isCategory(params.category) ? params.category : undefined,
  );
  const [subcategory, setSubcategory] = useState<SubcategoryId>();

  if (auth.status === 'loading') return <Status loading />;
  if (auth.status !== 'signedIn') {
    return (
      <View style={styles.centre}>
        <Body muted>{m.sell.signIn}</Body>
        <Button testID="login" label={m.auth.login} onPress={() => void auth.signIn()} />
      </View>
    );
  }
  if (!category) return <PickCategory onPick={setCategory} />;
  if (!subcategory) {
    return (
      <PickSubcategory
        category={category}
        onPick={setSubcategory}
        onBack={() => setCategory(undefined)}
      />
    );
  }
  return (
    <ListingForm
      category={category}
      subcategory={subcategory}
      onChange={() => {
        setSubcategory(undefined);
        setCategory(undefined);
      }}
    />
  );
}

function Tile({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      role="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.surfaceAlt }]}>
        <Icon name={icon} size={22} color={theme.text} aria-hidden />
      </View>
      <Text numberOfLines={2} style={[styles.tileText, { color: theme.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function PickCategory({ onPick }: { onPick: (c: CategoryId) => void }) {
  const { m } = useI18n();
  return (
    <ScrollView contentContainerStyle={styles.page} testID="pick-category">
      <Title>{m.sell.pickCategory}</Title>
      <View style={styles.grid}>
        {CATEGORIES.map((c) => (
          <Tile
            key={c}
            testID={`pick-category-${c}`}
            icon={CATEGORY_ICONS[c]}
            label={m.categories[c]}
            onPress={() => onPick(c)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function PickSubcategory({
  category,
  onPick,
  onBack,
}: {
  category: CategoryId;
  onPick: (s: SubcategoryId) => void;
  onBack: () => void;
}) {
  const { m } = useI18n();
  return (
    <ScrollView contentContainerStyle={styles.page} testID="pick-subcategory">
      <Picked label={m.categories[category]} icon={CATEGORY_ICONS[category]} onChange={onBack} />
      <Title>{fill(m.sell.pickSubcategory, { category: m.categories[category] })}</Title>
      <View style={styles.grid}>
        {subcategoriesOf(category).map((s) => (
          <Tile
            key={s}
            testID={`pick-subcategory-${s}`}
            icon={SUBCATEGORY_ICONS[s]}
            label={m.taxonomy.subcategories[s]}
            onPress={() => onPick(s)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

function Picked({
  label,
  icon,
  onChange,
}: {
  label: string;
  icon: IconName;
  onChange: () => void;
}) {
  const { m } = useI18n();
  const theme = useTheme();
  return (
    <View
      testID="picked-category"
      style={[styles.picked, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <View style={[styles.pickedIcon, { backgroundColor: theme.ink }]}>
        <Icon name={icon} size={18} color={theme.inkText} aria-hidden />
      </View>
      <Text numberOfLines={1} style={[styles.pickedText, { color: theme.text }]}>
        {label}
      </Text>
      <Pressable role="button" testID="change-category" onPress={onChange} hitSlop={8}>
        <Text style={[styles.change, { color: theme.accent }]}>{m.sell.change}</Text>
      </Pressable>
    </View>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.sectionHead}>
        <View style={[styles.step, { backgroundColor: theme.ink }]}>
          <Text style={[styles.stepText, { color: theme.inkText }]}>{n}</Text>
        </View>
        <Text role="heading" style={[styles.sectionTitle, { color: theme.text }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Label({ text, optional }: { text: string; optional?: boolean }) {
  const { m } = useI18n();
  const theme = useTheme();
  return (
    <Text style={[styles.label, { color: theme.text }]}>
      {text}
      {optional ? <Text style={{ color: theme.muted }}> ({m.sell.optional})</Text> : null}
    </Text>
  );
}

function ListingForm({
  category,
  subcategory,
  onChange,
}: {
  category: CategoryId;
  subcategory: SubcategoryId;
  onChange: () => void;
}) {
  const { m } = useI18n();
  const api = useApi();
  const auth = useAuth();
  const theme = useTheme();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(0);
  const [photoError, setPhotoError] = useState<string>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [price, setPrice] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [place, setPlace] = useState<Place>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const needsPrice = priceRequired(category);

  const upload = async (asset: ImagePicker.ImagePickerAsset) => {
    const body = new FormData();
    if (Platform.OS === 'web') {
      // The web build's picker hands over the File itself (fetching its data: or blob: URL would
      // be blocked by the page's Content-Security-Policy).
      if (!asset.file) throw new Error('no file from the picker');
      body.append('file', asset.file, asset.fileName ?? asset.file.name);
    } else {
      body.append('file', {
        uri: asset.uri,
        name: asset.fileName ?? 'photo.jpg',
        type: asset.mimeType ?? 'image/jpeg',
      } as unknown as Blob);
    }
    const res = await auth.fetch(
      new Request(`${config.apiBaseUrl}/api/v1/media`, { method: 'POST', body }),
    );
    if (res.ok) {
      const media = (await res.json()) as Media;
      setPhotos((p) => [...p, { id: media.id, thumb: media.urls.thumb }]);
      return;
    }
    const problem = (await res.json().catch(() => ({}))) as { errors?: Array<{ code?: string }> };
    const code = res.status === 413 ? 'too_large' : problem.errors?.[0]?.code;
    setPhotoError(
      IMAGE.includes(code as never)
        ? m.sell.imageErrors[code as (typeof IMAGE)[number]]
        : m.sell.imageErrors.generic,
    );
  };

  const pick = async (source: 'library' | 'camera') => {
    setPhotoError(undefined);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return setPhotoError(m.sell.cameraDenied);
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.8,
      exif: false,
      allowsMultipleSelection: source === 'library',
      selectionLimit: room,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, room)) {
      setUploading((n) => n + 1);
      try {
        await upload(asset);
      } catch {
        setPhotoError(m.sell.imageErrors.generic);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const missing =
    title.trim().length < 3 ||
    !description.trim() ||
    !place ||
    (needsPrice && price.trim() === '') ||
    ATTRIBUTE_FIELDS[category].some((f) => f.required && !attributes[f.key]?.trim());

  const publish = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.listings.POST('/api/v1/listings', {
        body: {
          category,
          subcategory,
          title: title.trim(),
          description: description.trim(),
          priceNok: needsPrice ? Number(price) : null,
          attributes: attributePayload(category, attributes),
          placeId: place!.id,
          imageIds: photos.map((p) => p.id),
        },
      });
      if (data) {
        router.replace(`/listings/${data.id}`);
        return;
      }
      const errors = (problem as { errors?: Array<{ code?: string }> } | undefined)?.errors ?? [];
      const policy = errors.find((e) => POLICY.includes(e.code as never))?.code;
      setError(
        policy
          ? m.sell.policy[policy as (typeof POLICY)[number]]
          : response.status === 400 || response.status === 422
            ? m.sell.invalid
            : m.common.error,
      );
    } catch {
      setError(m.common.error);
    } finally {
      setSaving(false);
    }
  };

  const select = (key: string, options: readonly string[]) => (
    <View style={styles.options}>
      {options.map((o) => (
        <Chip
          key={o}
          testID={`field-attr-${key}-${o}`}
          label={(m.taxonomy.values as Record<string, Record<string, string>>)[key]?.[o] ?? o}
          selected={attributes[key] === o}
          onPress={() => setAttributes((a) => ({ ...a, [key]: a[key] === o ? '' : o }))}
        />
      ))}
    </View>
  );
  const labels = m.taxonomy.attributes as Record<string, string>;
  const places = place ? [] : searchPlaces(PLACES, placeQuery, 6);

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        testID="listing-form"
      >
        <Picked
          label={`${m.categories[category]} › ${m.taxonomy.subcategories[subcategory]}`}
          icon={CATEGORY_ICONS[category]}
          onChange={onChange}
        />

        <Section n={1} title={m.sell.photos}>
          <Body muted style={styles.hint}>
            {m.sell.photosHint}
          </Body>
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <View key={p.id} style={styles.photo}>
                <Image
                  source={{ uri: absoluteUrl(p.thumb, config.apiBaseUrl) }}
                  style={{ ...styles.photoImage, backgroundColor: theme.placeholder }}
                />
                {i === 0 ? (
                  <Text style={[styles.main, { backgroundColor: theme.ink, color: theme.inkText }]}>
                    {m.sell.mainPhoto}
                  </Text>
                ) : null}
                <Pressable
                  role="button"
                  aria-label={m.sell.removePhoto}
                  hitSlop={6}
                  onPress={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}
                  style={[
                    styles.remove,
                    { backgroundColor: theme.surface, borderColor: theme.border },
                  ]}
                >
                  <Icon name="close" size={14} color={theme.text} />
                </Pressable>
              </View>
            ))}
            {uploading > 0 ? (
              <View style={[styles.photo, styles.photoSlot, { borderColor: theme.border }]}>
                <ActivityIndicator color={theme.muted} />
              </View>
            ) : null}
          </View>
          {photos.length < MAX_PHOTOS ? (
            <View style={styles.row}>
              <Button
                testID="add-photos"
                variant="secondary"
                label={m.sell.addPhotos}
                icon={<Icon name="images-outline" size={18} color={theme.text} />}
                onPress={() => void pick('library')}
              />
              {Platform.OS !== 'web' ? (
                <Button
                  testID="take-photo"
                  variant="secondary"
                  label={m.sell.takePhoto}
                  icon={<Icon name="camera-outline" size={18} color={theme.text} />}
                  onPress={() => void pick('camera')}
                />
              ) : null}
            </View>
          ) : null}
          {photoError ? (
            <Text role="alert" style={[styles.error, { color: theme.danger }]}>
              {photoError}
            </Text>
          ) : null}
        </Section>

        <Section n={2} title={m.sell.about}>
          <Label text={m.sell.titleLabel} />
          <Field
            testID="field-title"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder={m.sell.titlePlaceholder[category]}
            accessibilityLabel={m.sell.titleLabel}
          />
          <Label text={m.sell.description} />
          <Field
            testID="field-description"
            value={description}
            onChangeText={setDescription}
            maxLength={5000}
            multiline
            style={styles.multiline}
            accessibilityLabel={m.sell.description}
          />
        </Section>

        {ATTRIBUTE_FIELDS[category].length ? (
          <Section n={3} title={m.sell.details}>
            {ATTRIBUTE_FIELDS[category].map((f) => (
              <View key={f.key} style={styles.fieldGroup}>
                <Label text={labels[f.key] ?? f.key} optional={!f.required} />
                {f.kind === 'select' ? (
                  select(f.key, f.options)
                ) : (
                  <Field
                    testID={`field-attr-${f.key}`}
                    value={attributes[f.key] ?? ''}
                    onChangeText={(v) => setAttributes((a) => ({ ...a, [f.key]: v }))}
                    keyboardType={f.kind === 'number' ? 'number-pad' : 'default'}
                    maxLength={f.kind === 'text' ? f.maxLength : 9}
                    accessibilityLabel={labels[f.key] ?? f.key}
                    placeholder={f.kind === 'number' ? f.unit : undefined}
                  />
                )}
              </View>
            ))}
          </Section>
        ) : null}

        <Section
          n={ATTRIBUTE_FIELDS[category].length ? 4 : 3}
          title={needsPrice ? m.sell.priceAndPlace : m.sell.place}
        >
          {needsPrice ? (
            <>
              <Label text={m.sell.price} />
              <Field
                testID="field-price"
                value={price}
                onChangeText={(v) => setPrice(v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={10}
                placeholder="kr"
                accessibilityLabel={m.sell.price}
              />
            </>
          ) : null}
          <Label text={m.sell.place} />
          {place ? (
            <Chip
              testID="field-place-selected"
              label={`${place.name}  ✕`}
              selected
              onPress={() => {
                setPlace(undefined);
                setPlaceQuery('');
              }}
            />
          ) : (
            <>
              <Field
                testID="field-place"
                value={placeQuery}
                onChangeText={setPlaceQuery}
                placeholder={m.sell.placeSearch}
                accessibilityLabel={m.sell.place}
                icon={<Icon name="location-outline" size={18} color={theme.muted} />}
              />
              <View style={styles.options}>
                {places.map((p) => (
                  <Chip
                    key={p.id}
                    testID={`place-${p.id}`}
                    label={p.name}
                    onPress={() => setPlace(p)}
                  />
                ))}
              </View>
            </>
          )}
        </Section>

        {error ? (
          <Text role="alert" testID="form-error" style={[styles.error, { color: theme.danger }]}>
            {error}
          </Text>
        ) : null}
        <Button
          testID="publish"
          label={saving ? m.sell.publishing : m.sell.publish}
          disabled={missing || saving || uploading > 0}
          onPress={() => void publish()}
        />
        {missing ? (
          <Body muted style={styles.hint}>
            {m.sell.fillIn}
          </Body>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  page: { padding: space.xl - 4, gap: space.lg, paddingBottom: space.xxl * 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 110,
  },
  tileIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  pickedIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickedText: { flex: 1, fontFamily: fonts.semibold, fontSize: 15 },
  change: { fontFamily: fonts.semibold, fontSize: 15 },
  section: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  step: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontFamily: fonts.bold, fontSize: 13 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 18 },
  label: { fontFamily: fonts.medium, fontSize: 14 },
  hint: { fontSize: 14, lineHeight: 20 },
  fieldGroup: { gap: space.sm },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  photo: { width: 96, height: 96 },
  photoImage: { width: 96, height: 96, borderRadius: radius.md },
  photoSlot: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    fontFamily: fonts.semibold,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  remove: {
    position: 'absolute',
    right: -6,
    top: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  error: { fontFamily: fonts.medium, fontSize: 14 },
});
