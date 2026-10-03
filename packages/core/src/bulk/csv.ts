/**
 * Lightweight, robust RFC-4180 compliant CSV parser and generator.
 * Zero external dependencies.
 */

export function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentField.trim());
        currentField = '';
        lines.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        currentField = '';
        lines.push(currentRow);
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Push remainder if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  // Filter out any purely empty lines
  const nonEmptyLines = lines.filter(row => row.some(cell => cell.length > 0));
  if (nonEmptyLines.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = nonEmptyLines[0] || [];
  const headers = rawHeaders.map(h => h.trim());

  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < nonEmptyLines.length; r++) {
    const rowData: Record<string, string> = {};
    const cells = nonEmptyLines[r] || [];
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (header) {
        rowData[header] = (cells[c] ?? '').trim();
      }
    }
    rows.push(rowData);
  }

  return { headers, rows };
}

export function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const headerLine = headers.map(h => escapeCsvValue(h)).join(',');
  const rowLines = rows.map(row => {
    return headers.map(h => escapeCsvValue(row[h])).join(',');
  });

  return [headerLine, ...rowLines].join('\r\n');
}
