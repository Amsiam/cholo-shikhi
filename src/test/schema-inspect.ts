// Schema inventory helper (SD-226, NFR5.203): lists every leaf of a Zod schema that could carry free
// text. A leaf is allowed when it is an ID (uuid), an instant (ISO datetime), an enum, a literal, a
// number or a boolean; any other string is reported with its path.
import type { z } from 'zod';

type Def = {
  type: string;
  format?: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  options?: z.ZodType[];
};

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

const ALLOWED_STRING_FORMATS = new Set(['uuid', 'datetime']);

export function freeTextPaths(schema: z.ZodType, path = '$'): string[] {
  const def = defOf(schema);
  switch (def.type) {
    case 'object':
      return Object.entries(def.shape ?? {}).flatMap(([key, value]) =>
        freeTextPaths(value, `${path}.${key}`),
      );
    case 'nullable':
    case 'optional':
    case 'default':
    case 'readonly':
      return def.innerType ? freeTextPaths(def.innerType, path) : [path];
    case 'array':
      return def.element ? freeTextPaths(def.element, `${path}[]`) : [path];
    case 'union':
      return (def.options ?? []).flatMap((option) => freeTextPaths(option, path));
    case 'string':
      return def.format && ALLOWED_STRING_FORMATS.has(def.format) ? [] : [path];
    case 'enum':
    case 'literal':
    case 'number':
    case 'boolean':
    case 'null':
      return [];
    default:
      return [`${path} (${def.type})`];
  }
}
