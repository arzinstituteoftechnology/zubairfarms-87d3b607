export const MEAT_TYPES = ["Beef", "Mutton", "Goat", "Chicken", "Lamb", "Buffalo"] as const;
export type MeatType = typeof MEAT_TYPES[number];

export const fmtKg = (n: number | string | null | undefined) =>
  n == null ? "0.00 kg" : `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;

export const fmtMoney = (n: number | string | null | undefined) =>
  n == null ? "0.00" : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });