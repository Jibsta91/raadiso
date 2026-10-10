/*
 * Money as integer minor units plus an ISO 4217 currency (ADR-0040): no floating point in storage or
 * arithmetic. Zod-free, shared by the services, the website and the app.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

/** Digits after the decimal point. Intl knows every ISO 4217 currency; JPY has 0, USD and NOK 2. */
export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** 12.5 USD → 1250. Rounds half away from zero, so typed prices never lose a cent to binary floats. */
export function toMinor(major: number, currency: string): number {
  const factor = 10 ** currencyDigits(currency);
  return Math.sign(major) * Math.round(Math.abs(major) * factor);
}

/** 1250 USD cents → 12.5. Only for display and form values; compute in minor units. */
export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyDigits(currency);
}

/**
 * Parses what someone typed as a price ("1 250", "1,250.50", "1250,5") into minor units. Spaces and
 * the grouping character are ignored; the last "." or "," followed by one or two digits is the decimal
 * separator. Returns undefined for anything that isn't a non-negative amount.
 */
export function parseMajor(input: string, currency: string): number | undefined {
  const s = input.replace(/[\s\u00a0\u202f']/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return undefined;
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
  const whole = (m ? m[1]! : s).replace(/[.,]/g, '');
  const fraction = m ? m[2]! : '';
  if (!/^\d+$/.test(whole)) return undefined;
  const digits = currencyDigits(currency);
  if (fraction.length > digits) return undefined;
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
}

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * "$1,250" (en, USD), "1 250 kr" (nb, NOK). Whole amounts show no decimals; amounts with cents show
 * them. The locale decides the format, the currency the symbol: a Somali speaker in Norway sees kroner.
 */
export function formatMoney(money: Money, locale: string): string {
  const major = toMajor(money.amountMinor, money.currency);
  const whole = Number.isInteger(major);
  const key = `${locale}|${money.currency}|${whole}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency: money.currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : undefined,
      maximumFractionDigits: whole ? 0 : undefined,
    });
    formatters.set(key, f);
  }
  return f.format(major);
}

/** Our language codes to the Intl locale used for numbers and dates. */
export function intlLocale(locale: string): string {
  return locale === 'nb' ? 'nb-NO' : locale === 'so' ? 'so-SO' : 'en-GB';
}

/** The currency's symbol as the locale writes it: "$", "kr". */
export function currencySymbol(currency: string, locale: string): string {
  const format = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  });
  // Hermes (the app's engine on iOS) has no formatToParts: there, format zero and keep what isn't the
  // number ("$0.00" → "$", "kr 0,00" → "kr").
  if (typeof format.formatToParts !== 'function') {
    return format.format(0).replace(/[\d\s.,'\u00a0\u202f\u2019-]/gu, '') || currency;
  }
  return format.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

/**
 * `{price}` and `{previousPrice}` for a notice's text, formatted in the reader's language from the
 * notice's stored parameters (minor units and a currency, ADR-0040). Notices stored before that carry
 * whole kroner (`priceNok`, `previousPriceNok`).
 */
export function noticePrices(
  params: Record<string, string>,
  locale: string,
): Record<string, string> {
  const money = (minor?: string, kroner?: string) =>
    minor !== undefined && params.currency
      ? formatMoney({ amountMinor: Number(minor), currency: params.currency }, locale)
      : kroner !== undefined && kroner !== ''
        ? formatMoney({ amountMinor: Number(kroner) * 100, currency: 'NOK' }, locale)
        : undefined;
  const out: Record<string, string> = {};
  const price = money(params.amountMinor, params.priceNok);
  const previous = money(params.previousAmountMinor, params.previousPriceNok);
  if (price) out.price = price;
  if (previous) out.previousPrice = previous;
  return out;
}
