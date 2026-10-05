/**
 * Simple, robust RFC-4180 compliant CSV line parser.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headerLine = lines[0]!;
  const headers = parseCsvRow(headerLine).map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));

  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCells = parseCsvRow(lines[i]!);
    if (rawCells.length === 0 || (rawCells.length === 1 && rawCells[0] === '')) {
      continue;
    }
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      row[key] = (rawCells[c] ?? '').trim();
    }
    rows.push(row);
  }

  return rows;
}

export function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * Generates an error CSV from error records for user download.
 */
export function formatErrorCsv(errors: Array<{ rowNumber: number; reason: string; rawData?: string }>): string {
  const header = 'Row Number,Reason,Raw Data';
  const lines = errors.map(e => {
    const reasonEscaped = `"${(e.reason || '').replace(/"/g, '""')}"`;
    const dataEscaped = `"${(e.rawData || '').replace(/"/g, '""')}"`;
    return `${e.rowNumber},${reasonEscaped},${dataEscaped}`;
  });
  return [header, ...lines].join('\n');
}
