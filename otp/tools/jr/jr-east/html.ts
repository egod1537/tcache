import { JrEastPipelineError } from './errors.js';

export interface HtmlCell {
  tag: 'th' | 'td';
  attributes: string;
  className: string;
  html: string;
  text: string;
}

export interface HtmlRow {
  attributes: string;
  className: string;
  html: string;
  cells: HtmlCell[];
}

export function extractTableByClass(
  html: string,
  className: string,
  sourceUrl: string,
): string {
  const tables = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)];
  const match = tables.find((candidate) =>
    classTokens(attribute(candidate[1] ?? '', 'class')).includes(className),
  );
  if (match?.[2] === undefined) {
    throw new JrEastPipelineError(
      'PAGE_STRUCTURE_CHANGED',
      `Expected table.${className} was not found`,
      sourceUrl,
    );
  }
  return match[2];
}

export function parseRows(tableHtml: string): HtmlRow[] {
  return [...tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(
    (row) => {
      const attributes = row[1] ?? '';
      const body = row[2] ?? '';
      return {
        attributes,
        className: attribute(attributes, 'class'),
        html: body,
        cells: [...body.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(
          (cell) => ({
            tag: (cell[1]?.toLowerCase() ?? 'td') as 'th' | 'td',
            attributes: cell[2] ?? '',
            className: attribute(cell[2] ?? '', 'class'),
            html: cell[3] ?? '',
            text: htmlText(cell[3] ?? ''),
          }),
        ),
      };
    },
  );
}

export function attribute(attributes: string, name: string): string {
  const match = new RegExp(
    `\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(attributes);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

export function firstHref(html: string): string | undefined {
  const match = /<a\b([^>]*)>/i.exec(html);
  const href = match === null ? '' : attribute(match[1] ?? '', 'href');
  return href.length > 0 ? href : undefined;
}

export function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b([^>]*)>/gi)]
    .map((match) => attribute(match[1] ?? '', 'href'))
    .filter((href) => href.length > 0);
}

export function htmlText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

export function classTokens(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

export function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    emsp: ' ',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, token: string) => {
      if (token.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
      if (token.startsWith('#'))
        return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
      return named[token.toLowerCase()] ?? entity;
    },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
