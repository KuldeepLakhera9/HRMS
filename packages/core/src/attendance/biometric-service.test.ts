import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BiometricService, isIpInCidr, verifyHmacSignature } from './biometric-service.js';
import type { BiometricRepository } from './biometric-repository.js';
import type { AuditService } from '../audit/service.js';
import type { RequestContext } from '../routing/context.js';
import { UnauthorizedError } from '@hrms/shared';

describe('BiometricService (P2-BIO-01)', () => {
  let service: BiometricService;
  let mockRepo: Partial<BiometricRepository>;
  let mockAudit: Partial<AuditService>;

  const companyId = '00000000-0000-0000-0000-000000000001';
  const deviceId = 'BIO-DEV-001';
  const hmacSecret = 'super-secret-biometric-key-123';

  const systemCtx: RequestContext = {
    companyId,
    userId: '00000000-0000-0000-0000-000000000099',
    roles: ['system'],
    permissions: [],
    requestId: 'req-bio-1',
    isAuthenticated: true,
  };

  beforeEach(() => {
    mockRepo = {
      findDeviceByDeviceId: vi.fn().mockResolvedValue({
        id: 'dev-row-1',
        companyId,
        deviceId,
        name: 'Main Gate Bio Scanner',
        ipCidr: '192.168.1.0/24',
        hmacSecret,
        locationId: '00000000-0000-0000-0000-000000000010',
        isActive: true,
        lastSyncAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        rowVersion: 1,
      }),
      findEmployeeByBiometricId: vi.fn().mockImplementation((_cid, bioId) => {
        if (bioId === 'EMP-BIO-100') {
          return Promise.resolve({ id: '00000000-0000-0000-0000-000000000100' });
        }
        return Promise.resolve(null);
      }),
      insertBiometricPunch: vi.fn().mockResolvedValue({ punchId: 'punch-001', isDuplicate: false }),
      insertQuarantine: vi.fn().mockResolvedValue('quar-001'),
      updateDeviceSync: vi.fn().mockResolvedValue(undefined),
    };

    mockAudit = {
      recordEvent: vi.fn().mockResolvedValue('audit-bio-1'),
    };

    service = new BiometricService(mockRepo as BiometricRepository, mockAudit as AuditService);
  });

  describe('isIpInCidr utility', () => {
    it('correctly matches IPv4 in CIDR range', () => {
      expect(isIpInCidr('192.168.1.45', '192.168.1.0/24')).toBe(true);
      expect(isIpInCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
      expect(isIpInCidr('10.5.0.12', '10.0.0.0/8')).toBe(true);
      expect(isIpInCidr('172.16.0.1', '0.0.0.0/0')).toBe(true);
    });
  });

  describe('verifyHmacSignature utility', () => {
    it('verifies valid HMAC-SHA256 signature', () => {
      const payload = JSON.stringify({ deviceId: 'test', count: 5 });
      const secret = 'secret-key';
      const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      expect(verifyHmacSignature(payload, secret, sig)).toBe(true);
      expect(verifyHmacSignature(payload, secret, 'invalid-signature-1234')).toBe(false);
      expect(verifyHmacSignature(payload, 'wrong-secret', sig)).toBe(false);
    });
  });

  describe('ingestBatch', () => {
    it('rejects batch when device is not found', async () => {
      mockRepo.findDeviceByDeviceId = vi.fn().mockResolvedValue(null);

      await expect(
        service.ingestBatch(systemCtx, {
          deviceId: 'UNKNOWN-DEV',
          punches: [
            {
              biometricUserId: '100',
              punchTime: '2026-10-01T09:00:00Z',
              punchType: 'in',
            },
          ],
        }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('rejects batch when client IP is outside allowed CIDR', async () => {
      await expect(
        service.ingestBatch(
          systemCtx,
          {
            deviceId,
            punches: [
              {
                biometricUserId: '100',
                punchTime: '2026-10-01T09:00:00Z',
                punchType: 'in',
              },
            ],
          },
          { clientIp: '10.0.0.50' }, // Allowed is 192.168.1.0/24
        ),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('successfully processes mapped employee punches and quarantines unmapped biometric user IDs', async () => {
      const rawBody = JSON.stringify({ deviceId, punches: [] });
      const validSig = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');

      const result = await service.ingestBatch(
        systemCtx,
        {
          deviceId,
          punches: [
            {
              biometricUserId: 'EMP-BIO-100', // Mapped
              punchTime: '2026-10-01T09:00:00Z',
              punchType: 'in',
              rawRecordId: 'rec-001',
            },
            {
              biometricUserId: 'UNKNOWN-USER-999', // Unmapped
              punchTime: '2026-10-01T09:05:00Z',
              punchType: 'in',
              rawRecordId: 'rec-002',
            },
          ],
        },
        {
          clientIp: '192.168.1.100',
          signature: validSig,
          rawBody,
        },
      );

      expect(result.ingestedCount).toBe(1);
      expect(result.quarantinedCount).toBe(1);
      expect(result.totalProcessed).toBe(2);

      expect(mockRepo.insertBiometricPunch).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          employeeId: '00000000-0000-0000-0000-000000000100',
          punchType: 'in',
          deviceId,
        }),
        undefined,
      );

      expect(mockRepo.insertQuarantine).toHaveBeenCalledWith(
        companyId,
        expect.objectContaining({
          deviceId,
          biometricUserId: 'UNKNOWN-USER-999',
          errorReason: 'UNMAPPED_BIOMETRIC_USER_ID',
        }),
        undefined,
      );

      expect(mockRepo.updateDeviceSync).toHaveBeenCalledWith(companyId, deviceId, undefined);
      expect(mockAudit.recordEvent).toHaveBeenCalled();
    });

    it('handles duplicate punches gracefully without failing the batch', async () => {
      mockRepo.insertBiometricPunch = vi.fn().mockResolvedValue({ punchId: 'punch-001', isDuplicate: true });

      const result = await service.ingestBatch(
        systemCtx,
        {
          deviceId,
          punches: [
            {
              biometricUserId: 'EMP-BIO-100',
              punchTime: '2026-10-01T09:00:00Z',
              punchType: 'in',
            },
          ],
        },
        { clientIp: '192.168.1.10' },
      );

      expect(result.duplicateCount).toBe(1);
      expect(result.ingestedCount).toBe(0);
      expect(result.totalProcessed).toBe(1);
    });
  });
});
