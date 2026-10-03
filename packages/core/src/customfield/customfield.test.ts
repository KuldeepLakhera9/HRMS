import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PERMISSIONS } from '@hrms/shared';
import { CustomFieldService } from './service.js';
import { buildDynamicValidator, type CustomFieldDefinitionRecord } from './validation.js';
import type { CustomFieldRepository } from './repository.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';

describe('Custom Fields Unit Tests (P1-ORG-04)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  const baseCtx: RequestContext = {
    companyId,
    userId,
    sessionId: 'sess-1',
    roles: ['hr_manager'],
    permissions: [
      PERMISSIONS.ORG_CUSTOMFIELD_READ,
      PERMISSIONS.ORG_CUSTOMFIELD_MANAGE,
    ],
    requestId: 'req-1',
    isAuthenticated: true,
  };

  const sampleDefinitions: CustomFieldDefinitionRecord[] = [
    {
      id: 'def-1',
      companyId,
      entity: 'employee',
      key: 'shirt_size',
      label: 'T-Shirt Size',
      type: 'select',
      required: true,
      options: ['S', 'M', 'L', 'XL'],
      section: 'general',
      sortOrder: 1,
      viewPermission: null,
      editPermission: null,
      validation: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    },
    {
      id: 'def-2',
      companyId,
      entity: 'employee',
      key: 'badge_number',
      label: 'Badge Number',
      type: 'text',
      required: false,
      options: [],
      section: 'general',
      sortOrder: 2,
      viewPermission: null,
      editPermission: null,
      validation: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    },
    {
      id: 'def-3',
      companyId,
      entity: 'employee',
      key: 'experience_years',
      label: 'Years of Experience',
      type: 'number',
      required: true,
      options: [],
      section: 'general',
      sortOrder: 3,
      viewPermission: null,
      editPermission: null,
      validation: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
    },
  ];

  let mockRepo: Partial<CustomFieldRepository>;
  let mockAudit: Partial<AuditService>;
  let service: CustomFieldService;

  beforeEach(() => {
    mockRepo = {
      listByEntity: vi.fn().mockResolvedValue(sampleDefinitions),
      findById: vi.fn().mockResolvedValue(sampleDefinitions[0]),
      findByKey: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(sampleDefinitions[0]),
      update: vi.fn().mockResolvedValue(sampleDefinitions[0]),
      delete: vi.fn().mockResolvedValue(true),
    };

    mockAudit = {
      recordEvent: vi.fn().mockResolvedValue('audit-1'),
    };

    service = new CustomFieldService(
      mockRepo as CustomFieldRepository,
      mockAudit as AuditService,
    );
  });

  describe('buildDynamicValidator', () => {
    it('successfully validates compliant values', () => {
      const validator = buildDynamicValidator(sampleDefinitions);
      const result = validator.safeParse({
        shirt_size: 'M',
        badge_number: 'B-101',
        experience_years: 5,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.shirt_size).toBe('M');
        expect(result.data.experience_years).toBe(5);
      }
    });

    it('rejects missing required select value', () => {
      const validator = buildDynamicValidator(sampleDefinitions);
      const result = validator.safeParse({
        badge_number: 'B-101',
        experience_years: 3,
      });

      expect(result.success).toBe(false);
    });

    it('rejects option not in select list', () => {
      const validator = buildDynamicValidator(sampleDefinitions);
      const result = validator.safeParse({
        shirt_size: 'XXXXL',
        experience_years: 3,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('CustomFieldService CRUD & Authorization', () => {
    it('throws ForbiddenError if caller lacks read permission', async () => {
      const unauthCtx: RequestContext = {
        ...baseCtx,
        permissions: [],
      };

      await expect(service.listDefinitions(unauthCtx, 'employee')).rejects.toThrow(
        /permission/i,
      );
    });

    it('creates custom field definition and logs audit event', async () => {
      const created = await service.createDefinition(baseCtx, {
        entity: 'employee',
        key: 'shirt_size',
        label: 'T-Shirt Size',
        type: 'select',
        required: true,
        options: ['S', 'M'],
      });

      expect(created).toBeDefined();
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockAudit.recordEvent).toHaveBeenCalled();
    });

    it('throws ConflictError if key already exists', async () => {
      (mockRepo.findByKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleDefinitions[0]);

      await expect(
        service.createDefinition(baseCtx, {
          entity: 'employee',
          key: 'shirt_size',
          label: 'T-Shirt Size',
          type: 'select',
        }),
      ).rejects.toThrow(/already exists/i);
    });
  });
});
