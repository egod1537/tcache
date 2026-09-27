export function encodeCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string | number | undefined>>[],
): string {
  const lines = [columns.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(
      columns
        .map((column) => escapeCsvCell(row[column]?.toString() ?? ''))
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function escapeCsvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
