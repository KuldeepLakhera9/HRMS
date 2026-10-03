import { z } from 'zod';

export const BulkEmployeeRowSchema = z.object({
  empCode: z.string().min(1, 'Employee code is required').max(50),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  emailWork: z.string().email('Invalid work email address'),
  emailPersonal: z.string().email('Invalid personal email address').optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD')
    .optional()
    .nullable(),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).optional().nullable(),
  employmentType: z
    .enum(['full_time', 'part_time', 'contract', 'intern'])
    .default('full_time'),
  doj: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of joining must be YYYY-MM-DD'),
  status: z
    .enum(['draft', 'active', 'probation', 'notice', 'terminated'])
    .default('active'),
  departmentId: z.string().uuid().optional().nullable(),
  designationId: z.string().uuid().optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
  managerId: z.string().uuid().optional().nullable(),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'PAN must be valid Indian PAN format')
    .optional()
    .nullable(),
  aadhaar: z
    .string()
    .regex(/^\d{12}$/, 'Aadhaar must be a 12-digit number')
    .optional()
    .nullable(),
  bankAccount: z.string().min(8).max(30).optional().nullable(),
});

export type BulkEmployeeRow = z.infer<typeof BulkEmployeeRowSchema>;

export interface ParsedCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
  data?: BulkEmployeeRow;
  customFields?: Record<string, unknown>;
  errors?: Array<{ column?: string; message: string }>;
}
