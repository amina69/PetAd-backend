/**
 * Money is always represented as an integer amount in minor units together
 * with its currency, exactly like the frontend `Money` type. Never return a
 * float or a formatted string from the API.
 */
export interface Money {
  amountMinor: number;
  currency: string;
}

export function toMoney(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `Money amounts must be integers in minor units, received ${amountMinor}`,
    );
  }

  return { amountMinor, currency };
}
