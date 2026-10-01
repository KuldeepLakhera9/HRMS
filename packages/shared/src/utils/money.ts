/**
 * Money utilities:
 * AGENTS.md rule: "Money: numeric(14,2) or integer paise, never floats."
 */

export function toPaise(rupees: number | string): number {
  const num = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (isNaN(num)) {
    throw new TypeError(`Cannot convert invalid number '${rupees}' to paise`);
  }
  return Math.round(num * 100);
}

export function toRupees(paise: number | bigint): number {
  const p = typeof paise === 'bigint' ? Number(paise) : paise;
  return p / 100;
}

export function formatINR(paise: number | bigint): string {
  const rupees = toRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}
