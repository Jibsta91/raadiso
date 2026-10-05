/** Colour of an order status pill. */
export const orderTone = (s: string) =>
  s === 'captured'
    ? 'good'
    : s === 'refunded'
      ? 'info'
      : s === 'failed' || s === 'cancelled'
        ? 'bad'
        : s === 'expired'
          ? 'neutral'
          : 'warn';
