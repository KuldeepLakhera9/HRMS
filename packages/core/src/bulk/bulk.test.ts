import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PERMISSIONS } from '@hrms/shared';
import { parseCsv, generateCsv } from './csv.js';
import { BulkService } from './service.js';
import type { BulkRepository, ImportJobRow } from './repository.js';
import type { CustomFieldService } from '../customfield/service.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';

describe('Bulk Import & Export Unit Tests (P1-EMP-06)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  const baseCtx: RequestContext = {
    companyId,
    userId,
    sessionId: 'sess-1',
    roles: ['hr_manager'],
    permissions: [
      PERMISSIONS.EMPLOYEE_PROFILE_READ,
      PERMISSIONS.EMPLOYEE_PROFILE_IMPORT,
      PERMISSIONS.EMPLOYEE_PROFILE_EXPORT,
      PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE,
      PERMISSIONS.ORG_CUSTOMFIELD_READ,
    ],
    requestId: 'req-1',
    isAuthenticated: true,
  };

  describe('RFC-4180 CSV Engine', () => {
    it('parses unquoted and quoted values with commas and escaped quotes', () => {
      const csv = `empCode,firstName,lastName,notes\nEMP001,"John, Jr.",Doe,"He said ""Hello"""\nEMP002,Jane,Smith,Single`;
      const { headers, rows } = parseCsv(csv);

      expect(headers).toEqual(['empCode', 'firstName', 'lastName', 'notes']);
      expect(rows).toHaveLength(2);
      expect(rows[0]!['firstName']).toBe('John, Jr.');
      expect(rows[0]!['notes']).toBe('He said "Hello"');
      expect(rows[1]!['empCode']).toBe('EMP002');
    });

    it('generates standard escaped CSV string', () => {
      const headers = ['code', 'name', 'desc'];
      const data = [
        { code: 'A1', name: 'John, Doe', desc: 'Line 1\nLine 2' },
        { code: 'B2', name: 'Plain', desc: 'Simple' },
      ];

      const csv = generateCsv(headers, data);
      expect(csv).toContain('code,name,desc');
      expect(csv).toContain('"John, Doe"');
      expect(csv).toContain('"Line 1\nLine 2"');
    });
  });

  describe('BulkService Import Validation', () => {
    let mockRepo: Partial<BulkRepository>;
    let mockCfService: Partial<CustomFieldService>;
    let mockAuditService: Partial<AuditService>;
    let service: BulkService;

    const dummyJob: ImportJobRow = {
      id: 'job-123',
      companyId,
      fileId: null,
      entity: 'employee',
      status: 'validated',
      totalRows: 2,
      validRows: 1,
      errorRows: 1,
      errors: [
        {
          row: 3,
          empCode: 'EMP002',
          column: 'emailWork',
          message: 'Invalid work email address',
          value: 'invalid-email',
        },
      ],
      summary: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId,
      updatedBy: userId,
      rowVersion: 1,
    };

    beforeEach(() => {
      mockRepo = {
        createJob: vi.fn().mockResolvedValue(dummyJob),
        findJobById: vi.fn().mockResolvedValue(dummyJob),
        updateJob: vi.fn().mockResolvedValue(dummyJob),
        batchUpsertEmployees: vi.fn().mockResolvedValue({ inserted: 1, updated: 0 }),
        getValidOrgEntityIds: vi.fn().mockResolvedValue({
          departments: new Set(),
          designations: new Set(),
          locations: new Set(),
        }),
      };

      mockCfService = {
        listDefinitions: vi.fn().mockResolvedValue([]),
      };

      mockAuditService = {
        recordEvent: vi.fn().mockResolvedValue('audit-1'),
      };

      service = new BulkService(
        mockRepo as BulkRepository,
        mockAuditService as AuditService,
        mockCfService as CustomFieldService,
      );
    });

    it('validates rows, flags per-row errors, and creates import job', async () => {
      const csv = `empCode,firstName,lastName,emailWork,doj\nEMP001,John,Doe,john@example.com,2023-01-01\nEMP002,Jane,Smith,invalid-email,2023-01-01`;

      const result = await service.validateImport(baseCtx, csv);

      expect(result.jobId).toBe('job-123');
      expect(result.totalRows).toBe(2);
      expect(result.errorRows).toBe(1);
      expect(result.validRows).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.column).toBe('emailWork');
      expect(mockRepo.createJob).toHaveBeenCalled();
    });

    it('throws ForbiddenError if caller lacks import permission', async () => {
      const unauthCtx: RequestContext = {
        ...baseCtx,
        permissions: [],
      };

      await expect(
        service.validateImport(unauthCtx, 'empCode,firstName\n1,2'),
      ).rejects.toThrow(/permission/i);
    });

    it('generates downloadable error CSV', async () => {
      const errorCsv = await service.getErrorCsv(baseCtx, 'job-123');

      expect(errorCsv).toContain('RowNumber,EmployeeCode,Column,ErrorMessage,Value');
      expect(errorCsv).toContain('3,EMP002,emailWork,Invalid work email address,invalid-email');
    });
  });
});
