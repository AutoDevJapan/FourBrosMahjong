export const MAX_STRICT_JSON_NESTING = 128;

const JSON_WHITESPACE = new Set([0x09, 0x0a, 0x0d, 0x20]);
const JSON_ESCAPES = new Set([0x22, 0x2f, 0x5c, 0x62, 0x66, 0x6e, 0x72, 0x74]);

type ParsedString = {
  value: string;
  next: number;
};

function rejectStrictJson(): never {
  throw new SyntaxError("strict JSON rejected");
}

function isWhitespace(code: number): boolean {
  return JSON_WHITESPACE.has(code);
}

function isHexDigit(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && isWhitespace(source.charCodeAt(cursor))) {
    cursor += 1;
  }
  return cursor;
}

function parseString(source: string, start: number): ParsedString {
  if (source.charCodeAt(start) !== 0x22) return rejectStrictJson();

  let cursor = start + 1;
  while (cursor < source.length) {
    const code = source.charCodeAt(cursor);
    if (code === 0x22) {
      const raw = source.slice(start, cursor + 1);
      try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "string") return rejectStrictJson();
        return { value, next: cursor + 1 };
      } catch {
        return rejectStrictJson();
      }
    }
    if (code < 0x20) return rejectStrictJson();
    if (code === 0x5c) {
      cursor += 1;
      const escape = source.charCodeAt(cursor);
      if (JSON_ESCAPES.has(escape)) {
        cursor += 1;
        continue;
      }
      if (escape !== 0x75) return rejectStrictJson();
      for (let offset = 1; offset <= 4; offset += 1) {
        if (!isHexDigit(source.charCodeAt(cursor + offset))) {
          return rejectStrictJson();
        }
      }
      cursor += 5;
      continue;
    }
    cursor += 1;
  }
  return rejectStrictJson();
}

function parseValue(source: string, start: number, depth: number): number {
  if (depth > MAX_STRICT_JSON_NESTING) return rejectStrictJson();

  const cursor = skipWhitespace(source, start);
  const code = source.charCodeAt(cursor);
  if (code === 0x22) return parseString(source, cursor).next;
  if (code === 0x7b) return parseObject(source, cursor, depth);
  if (code === 0x5b) return parseArray(source, cursor, depth);

  if (source.startsWith("true", cursor)) return cursor + 4;
  if (source.startsWith("false", cursor)) return cursor + 5;
  if (source.startsWith("null", cursor)) return cursor + 4;

  let end = cursor;
  while (end < source.length) {
    const delimiter = source.charCodeAt(end);
    if (
      isWhitespace(delimiter) ||
      delimiter === 0x2c ||
      delimiter === 0x5d ||
      delimiter === 0x7d
    ) {
      break;
    }
    end += 1;
  }
  if (end === cursor) return rejectStrictJson();
  return end;
}

function parseObject(source: string, start: number, depth: number): number {
  let cursor = skipWhitespace(source, start + 1);
  const keys = new Set<string>();
  if (source.charCodeAt(cursor) === 0x7d) return cursor + 1;

  while (true) {
    const key = parseString(source, cursor);
    if (keys.has(key.value)) return rejectStrictJson();
    keys.add(key.value);

    cursor = skipWhitespace(source, key.next);
    if (source.charCodeAt(cursor) !== 0x3a) return rejectStrictJson();
    cursor = skipWhitespace(source, parseValue(source, cursor + 1, depth + 1));

    const delimiter = source.charCodeAt(cursor);
    if (delimiter === 0x7d) return cursor + 1;
    if (delimiter !== 0x2c) return rejectStrictJson();
    cursor = skipWhitespace(source, cursor + 1);
  }
}

function parseArray(source: string, start: number, depth: number): number {
  let cursor = skipWhitespace(source, start + 1);
  if (source.charCodeAt(cursor) === 0x5d) return cursor + 1;

  while (true) {
    cursor = skipWhitespace(source, parseValue(source, cursor, depth + 1));
    const delimiter = source.charCodeAt(cursor);
    if (delimiter === 0x5d) return cursor + 1;
    if (delimiter !== 0x2c) return rejectStrictJson();
    cursor = skipWhitespace(source, cursor + 1);
  }
}

/**
 * Parse JSON while rejecting duplicate object names before native parsing can
 * silently choose one of them. Callers must enforce their own input-size cap.
 */
export function parseStrictJson(source: string): unknown {
  if (typeof source !== "string") {
    throw new TypeError("strict JSON source must be a string");
  }
  const end = parseValue(source, 0, 0);
  if (skipWhitespace(source, end) !== source.length) {
    return rejectStrictJson();
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return rejectStrictJson();
  }
}
