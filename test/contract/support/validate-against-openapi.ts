type JsonSchema = Record<string, any>;

export function resolveSchema(
  document: JsonSchema,
  schema: JsonSchema,
): JsonSchema {
  if (typeof schema.$ref !== 'string') return schema;
  const parts = schema.$ref.replace(/^#\//, '').split('/');
  let resolved: any = document;
  for (const part of parts) {
    resolved = resolved?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  if (!resolved || typeof resolved !== 'object') {
    throw new Error(`Unresolved $ref: ${schema.$ref}`);
  }
  return resolveSchema(document, resolved);
}

export function validateFixture(
  document: JsonSchema,
  schemaName: string,
  fixture: unknown,
): string[] {
  const schema = document.components?.schemas?.[schemaName];
  if (!schema) throw new Error(`Missing schema ${schemaName}`);
  return validate(document, schema, fixture, schemaName);
}

function validate(
  document: JsonSchema,
  schema: JsonSchema,
  value: unknown,
  path: string,
): string[] {
  const resolved = resolveSchema(document, schema);
  const errors: string[] = [];

  if (resolved.nullable === true && value === null) return errors;

  if (Array.isArray(resolved.allOf)) {
    for (const part of resolved.allOf) {
      errors.push(...validate(document, part, value, path));
    }
    return errors;
  }

  if (Array.isArray(resolved.oneOf) || Array.isArray(resolved.anyOf)) {
    const variants: JsonSchema[] = resolved.oneOf ?? resolved.anyOf;
    const variantErrors = variants.map((variant) =>
      validate(document, variant, value, path),
    );
    if (!variantErrors.some((variantError) => variantError.length === 0)) {
      errors.push(`${path} does not match any allowed variant`);
    }
    return errors;
  }

  if (resolved.enum && !resolved.enum.includes(value)) {
    errors.push(`${path} must be one of ${JSON.stringify(resolved.enum)}`);
    return errors;
  }

  if (resolved.type) {
    const types = Array.isArray(resolved.type) ? resolved.type : [resolved.type];
    const actual = actualType(value);
    const matches =
      types.includes(actual) ||
      (actual === 'integer' && types.includes('number'));
    if (!matches) {
      errors.push(`${path} expected ${types.join('|')} but received ${actual}`);
      return errors;
    }
  }

  if (Array.isArray(value)) {
    if (resolved.items) {
      value.forEach((item, index) => {
        errors.push(...validate(document, resolved.items, item, `${path}[${index}]`));
      });
    }
    return errors;
  }

  if (isObject(value)) {
    for (const required of resolved.required ?? []) {
      if (!(required in value)) {
        errors.push(`${path}.${required} is required`);
      }
    }
    for (const [key, child] of Object.entries(resolved.properties ?? {})) {
      if (key in value) {
        errors.push(
          ...validate(document, child as JsonSchema, value[key], `${path}.${key}`),
        );
      }
    }
  }

  return errors;
}

function actualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
