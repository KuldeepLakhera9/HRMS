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

export function formatIndianGrouping(rupees: number | string): string {
  const num = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (isNaN(num)) return '0.00';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function convertLessThanThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const rem = n % 10;
    return TENS[Math.floor(n / 10)]! + (rem ? `-${ONES[rem]}` : '');
  }
  const rem = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred` + (rem ? ` and ${convertLessThanThousand(rem)}` : '');
}

/**
 * Converts a numerical amount in INR to words following standard Indian financial conventions.
 * e.g. 1250000.50 -> "Rupees Twelve Lakh Fifty Thousand and Fifty Paise Only"
 */
export function numberToIndianWords(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num) || num === 0) {
    return 'Rupees Zero Only';
  }

  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const rupees = Math.floor(absNum);
  const paise = Math.round((absNum - rupees) * 100);

  let remaining = rupees;
  const parts: string[] = [];

  // Crores (1,00,00,000)
  if (remaining >= 10000000) {
    const crores = Math.floor(remaining / 10000000);
    parts.push(`${convertLessThanThousand(crores)} Crore`);
    remaining %= 10000000;
  }

  // Lakhs (1,00,000)
  if (remaining >= 100000) {
    const lakhs = Math.floor(remaining / 100000);
    parts.push(`${convertLessThanThousand(lakhs)} Lakh`);
    remaining %= 100000;
  }

  // Thousands (1,000)
  if (remaining >= 1000) {
    const thousands = Math.floor(remaining / 1000);
    parts.push(`${convertLessThanThousand(thousands)} Thousand`);
    remaining %= 1000;
  }

  // Hundreds and units
  if (remaining > 0) {
    parts.push(convertLessThanThousand(remaining));
  }

  let result = (isNegative ? 'Minus ' : '') + 'Rupees ' + (parts.join(' ') || 'Zero');

  if (paise > 0) {
    result += ` and ${convertLessThanThousand(paise)} Paise`;
  }

  return `${result.trim()} Only`;
}
