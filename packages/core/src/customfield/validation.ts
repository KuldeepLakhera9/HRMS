import { z, type ZodTypeAny } from 'zod';

export const createCustomFieldSchema = z.object({
  entity: z.enum(['employee', 'department', 'location']),
  key: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-zA-Z0-9_]*$/, 'Key must start with a lowercase letter and contain only alphanumeric characters and underscores'),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'number', 'date', 'select', 'boolean', 'json']),
  required: z.boolean().default(false),
  options: z.array(z.union([z.string(), z.object({ label: z.string(), value: z.string() })])).default([]),
  section: z.string().min(1).max(50).default('general'),
  sortOrder: z.coerce.number().int().default(0),
  viewPermission: z.string().optional().nullable(),
  editPermission: z.string().optional().nullable(),
  validation: z.record(z.unknown()).default({}),
});

export const updateCustomFieldSchema = createCustomFieldSchema.partial().omit({ entity: true, key: true });

export type CreateCustomFieldInput = z.input<typeof createCustomFieldSchema>;
export type UpdateCustomFieldInput = z.input<typeof updateCustomFieldSchema>;

export interface CustomFieldDefinitionRecord {
  id: string;
  companyId: string;
  entity: 'employee' | 'department' | 'location';
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'json';
  required: boolean;
  options: string[] | { label: string; value: string }[];
  section: string;
  sortOrder: number;
  viewPermission: string | null;
  editPermission: string | null;
  validation: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  rowVersion: number;
}

/**
 * Builds a dynamic Zod validator based on active custom field definitions.
 */
export function buildDynamicValidator(definitions: CustomFieldDefinitionRecord[]): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};

  for (const def of definitions) {
    let schema: ZodTypeAny;

    switch (def.type) {
      case 'text':
        schema = z.string();
        if (def.required) {
          schema = (schema as z.ZodString).min(1, `${def.label} is required`);
        }
        break;

      case 'number':
        schema = z.coerce.number();
        break;

      case 'date':
        schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${def.label} must be formatted as YYYY-MM-DD`);
        break;

      case 'boolean':
        schema = z.boolean();
        break;

      case 'select': {
        const allowed = def.options.map(opt => (typeof opt === 'string' ? opt : opt.value));
        if (allowed.length > 0) {
          schema = z.string().refine(val => allowed.includes(val), {
            message: `${def.label} must be one of: ${allowed.join(', ')}`,
          });
        } else {
          schema = z.string();
        }
        break;
      }

      case 'json':
      default:
        schema = z.record(z.unknown());
        break;
    }

    if (!def.required) {
      schema = schema.optional().nullable();
    }

    shape[def.key] = schema;
  }

  return z.object(shape);
}
