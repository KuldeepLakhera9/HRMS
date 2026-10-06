import { describe, it, expect, vi } from 'vitest';
import { StatutoryRulesService } from './service.js';
import { StatutoryRulesRepository } from './repository.js';
import { StatutoryRuleSet, Database } from '@hrms/db';
import { PERMISSIONS } from '@hrms/shared';

describe('StatutoryRulesService', () => {
  const mockRepo = {
    createRuleSet: vi.fn(),
    updateRuleSet: vi.fn(),
    getRuleSetById: vi.fn(),
    getActiveRuleSet: vi.fn(),
    getLatestVersionNumber: vi.fn(),
    listRuleSetVersions: vi.fn(),
    listAllRuleSets: vi.fn(),
  } as unknown as StatutoryRulesRepository;

  const mockDb = {} as unknown as Database;
  const service = new StatutoryRulesService(mockRepo);

  const makerCtx = {
    companyId: 'comp-1',
    userId: 'user-maker-1',
    roles: ['accountant'],
    permissions: [PERMISSIONS.PAYROLL_RULES_MANAGE, PERMISSIONS.PAYROLL_RULES_READ],
    requestId: 'req-maker-1',
    isAuthenticated: true,
  };

  const checkerCtx = {
    companyId: 'comp-1',
    userId: 'user-checker-2',
    roles: ['finance_head'],
    permissions: [PERMISSIONS.PAYROLL_RULES_APPROVE, PERMISSIONS.PAYROLL_RULES_READ],
    requestId: 'req-checker-2',
    isAuthenticated: true,
  };

  const samplePfPayload = {
    employeeRatePct: 12,
    employerEpsRatePct: 8.33,
    employerEpfRatePct: 3.67,
    edliRatePct: 0.5,
    adminChargeRatePct: 0.5,
    wageCeilingMonthly: 15000,
    allowContributeOnActual: true,
    allowVpf: true,
    roundingMode: 'half_up' as const,
    ecrFileFormatVersion: '2.0',
    ncpDaysRule: 'lop_only' as const,
  };

  it('creates draft rule set with incremented version', async () => {
    vi.mocked(mockRepo.getLatestVersionNumber).mockResolvedValue(1);
    vi.mocked(mockRepo.createRuleSet).mockImplementation(async (_db, data) => ({
      ...data,
      id: 'rule-new-2',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      rowVersion: 1,
      checkerId: null,
      caVerifiedBy: null,
      caVerifiedOn: null,
      effectiveTo: null,
      sourceNote: null,
      testCases: [],
      createdBy: makerCtx.userId,
      updatedBy: makerCtx.userId,
    } as unknown as StatutoryRuleSet));

    const result = await service.createDraftRuleSet(makerCtx, mockDb, {
      key: 'PF_IN',
      jurisdiction: 'IN',
      effectiveFrom: '2026-04-01',
      payload: samplePfPayload,
    });

    expect(result.version).toBe(2);
    expect(result.status).toBe('draft');
    expect(result.makerId).toBe(makerCtx.userId);
  });

  it('rejects payload that violates statutory Zod schema', async () => {
    const invalidPayload = {
      ...samplePfPayload,
      employeeRatePct: 150, // exceeds max 100
    };

    await expect(
      service.createDraftRuleSet(makerCtx, mockDb, {
        key: 'PF_IN',
        jurisdiction: 'IN',
        effectiveFrom: '2026-04-01',
        payload: invalidPayload,
      }),
    ).rejects.toThrow();
  });

  it('blocks maker from approving their own rule set (Segregation of Duties)', async () => {
    vi.mocked(mockRepo.getRuleSetById).mockResolvedValue({
      id: 'rule-1',
      companyId: 'comp-1',
      key: 'PF_IN',
      jurisdiction: 'IN',
      version: 1,
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
      payload: samplePfPayload,
      status: 'pending_approval',
      makerId: 'user-maker-1', // Same user!
      checkerId: null,
      caVerifiedBy: null,
      caVerifiedOn: null,
      sourceNote: null,
      testCases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'user-maker-1',
      updatedBy: 'user-maker-1',
      deletedAt: null,
      rowVersion: 1,
    });

    // Maker tries to approve with checker permission
    const dualRoleCtx = {
      ...makerCtx,
      permissions: [PERMISSIONS.PAYROLL_RULES_APPROVE],
    };

    await expect(
      service.approveAndActivate(dualRoleCtx, mockDb, 'rule-1'),
    ).rejects.toThrow(/Segregation of duties violation/);
  });

  it('allows different checker to approve and activate rule set', async () => {
    vi.mocked(mockRepo.getRuleSetById).mockResolvedValue({
      id: 'rule-1',
      companyId: 'comp-1',
      key: 'PF_IN',
      jurisdiction: 'IN',
      version: 1,
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
      payload: samplePfPayload,
      status: 'pending_approval',
      makerId: 'user-maker-1',
      checkerId: null,
      caVerifiedBy: null,
      caVerifiedOn: null,
      sourceNote: null,
      testCases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'user-maker-1',
      updatedBy: 'user-maker-1',
      deletedAt: null,
      rowVersion: 1,
    });

    vi.mocked(mockRepo.getActiveRuleSet).mockResolvedValue(null);
    vi.mocked(mockRepo.updateRuleSet).mockImplementation(async (_db, _cid, _id, update) => ({
      id: 'rule-1',
      companyId: 'comp-1',
      key: 'PF_IN',
      jurisdiction: 'IN',
      version: 1,
      effectiveFrom: '2026-04-01',
      effectiveTo: null,
      payload: samplePfPayload,
      status: update.status ?? 'active',
      makerId: 'user-maker-1',
      checkerId: update.checkerId ?? null,
      caVerifiedBy: update.caVerifiedBy ?? null,
      caVerifiedOn: update.caVerifiedOn ?? null,
      sourceNote: null,
      testCases: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'user-maker-1',
      updatedBy: update.updatedBy ?? 'user-maker-1',
      deletedAt: null,
      rowVersion: 1,
    }));

    const result = await service.approveAndActivate(
      checkerCtx,
      mockDb,
      'rule-1',
      { caVerifiedBy: 'CA Ramesh Sharma (Membership #045892)' },
    );

    expect(result.status).toBe('active');
    expect(result.checkerId).toBe(checkerCtx.userId);
    expect(result.caVerifiedBy).toBe('CA Ramesh Sharma (Membership #045892)');
  });

  it('computes diff between two rule versions correctly', async () => {
    vi.mocked(mockRepo.getRuleSetById).mockImplementation(async (_db, _cid, id) => {
      if (id === 'ver-1') {
        return {
          id: 'ver-1',
          payload: { wageCeilingMonthly: 15000, employeeRatePct: 12 },
        } as unknown as StatutoryRuleSet;
      }
      return {
        id: 'ver-2',
        payload: { wageCeilingMonthly: 21000, employeeRatePct: 12, newField: true },
      } as unknown as StatutoryRuleSet;
    });

    const diff = await service.diffRuleSets(makerCtx, mockDb, 'ver-1', 'ver-2');
    expect(diff.changed.wageCeilingMonthly).toEqual({ from: 15000, to: 21000 });
    expect(diff.added.newField).toBe(true);
  });
});
