/* The values of select attributes (ADR-0040). Labels live in the message catalogues. Append only. */

export const CONDITIONS = ['new', 'like_new', 'good', 'fair'] as const;
export const FUELS = ['petrol', 'diesel', 'electric', 'hybrid'] as const;
export const GEARBOXES = ['manual', 'automatic'] as const;
export const PROPERTY_TYPES = [
  'apartment',
  'house',
  'townhouse',
  'cabin',
  'plot',
  'commercial',
] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'temporary', 'internship'] as const;
export const BODY_TYPES = [
  'sedan',
  'station_wagon',
  'hatchback',
  'suv',
  'coupe',
  'convertible',
  'mpv',
  'pickup',
] as const;
export const DRIVETRAINS = ['fwd', 'rwd', 'awd'] as const;
export const OWNERSHIPS = ['freehold', 'cooperative', 'shares'] as const;

/** Imported vehicles: new, used abroad and imported, or used in the country. */
export const USAGES = ['brand_new', 'foreign_used', 'locally_used'] as const;
export const STEERING = ['left', 'right'] as const;
export const HOME_TYPES = ['house', 'apartment', 'villa', 'room'] as const;
export const COMMERCIAL_TYPES = ['shop', 'office', 'warehouse', 'hotel'] as const;
export const DEAL_TYPES = ['rent', 'sale'] as const;
export const FURNISHING = ['furnished', 'unfurnished'] as const;
export const LAND_USES = ['residential', 'commercial', 'agricultural'] as const;
export const LIVESTOCK_SEX = ['male', 'female', 'mixed'] as const;
export const PHONE_BRANDS = [
  'apple',
  'samsung',
  'tecno',
  'infinix',
  'xiaomi',
  'huawei',
  'oppo',
  'nokia',
  'itel',
  'other',
] as const;
export const COMPUTER_TYPES = ['laptop', 'desktop', 'monitor', 'printer', 'accessory'] as const;
export const SOLAR_TYPES = ['panel', 'battery', 'inverter', 'kit', 'light'] as const;
export const APPLIANCE_TYPES = [
  'fridge',
  'air_conditioner',
  'washing_machine',
  'cooker',
  'water_dispenser',
  'fan',
] as const;
