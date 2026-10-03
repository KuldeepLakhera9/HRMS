import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceService } from './device-service.js';
import type { RequestContext } from '../routing/context.js';
import type { DeviceRepository } from './device-repository.js';
import type { AuditService } from '../audit/service.js';
import type { WorkflowService } from '../workflow/service.js';
import { DevStubAttestationVerifier } from './attestation.js';

describe('P2-PUNCH-03: DeviceService Tests', () => {
  let mockDeviceRepo: {
    getActiveDevice: ReturnType<typeof vi.fn>;
    getDeviceById: ReturnType<typeof vi.fn>;
    getDeviceByHardwareId: ReturnType<typeof vi.fn>;
    createDevice: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    updateAttestation: ReturnType<typeof vi.fn>;
  };
  let mockAuditService: {
    recordEvent: ReturnType<typeof vi.fn>;
  };
  let mockWorkflowService: {
    submitRequest: ReturnType<typeof vi.fn>;
  };
  let service: DeviceService;

  const sampleContext: RequestContext = {
    companyId: '11111111-1111-7111-8111-111111111111',
    userId: '22222222-2222-7222-8222-222222222222',
    employeeId: '33333333-3333-7333-8333-333333333333',
    roles: ['employee'],
    permissions: [],
    isAuthenticated: true,
    requestId: 'req-dev-1',
  };

  const adminContext: RequestContext = {
    ...sampleContext,
    roles: ['super_admin'],
    permissions: ['attendance.device.manage'],
  };

  beforeEach(() => {
    mockDeviceRepo = {
      getActiveDevice: vi.fn(),
      getDeviceById: vi.fn(),
      getDeviceByHardwareId: vi.fn(),
      createDevice: vi.fn(),
      updateStatus: vi.fn(),
      updateAttestation: vi.fn(),
    };
    mockAuditService = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };
    mockWorkflowService = {
      submitRequest: vi.fn().mockResolvedValue({ requestId: 'wf-req-dev-1', status: 'pending' }),
    };

    service = new DeviceService(
      mockDeviceRepo as unknown as DeviceRepository,
      mockAuditService as unknown as AuditService,
      mockWorkflowService as unknown as WorkflowService,
      new DevStubAttestationVerifier(),
    );
  });

  describe('Device Registration & 1-Active-Device Rule', () => {
    it('registers first device as active immediately', async () => {
      mockDeviceRepo.getActiveDevice.mockResolvedValueOnce(null);
      mockDeviceRepo.createDevice.mockResolvedValueOnce({
        id: 'dev-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-pixel-8',
        deviceModel: 'Pixel 8',
        osName: 'Android',
        osVersion: '14',
        appVersion: '1.0.0',
        status: 'active',
      });

      const res = await service.registerDevice(sampleContext, {
        deviceId: 'hw-pixel-8',
        deviceModel: 'Pixel 8',
        osName: 'Android',
        osVersion: '14',
        appVersion: '1.0.0',
      });

      expect(res.status).toBe('active');
      expect(res.requiresApproval).toBe(false);
      expect(mockDeviceRepo.createDevice).toHaveBeenCalledWith(
        sampleContext.companyId,
        expect.objectContaining({
          status: 'active',
          deviceId: 'hw-pixel-8',
        }),
        undefined,
      );
      expect(mockAuditService.recordEvent).toHaveBeenCalled();
    });

    it('returns existing active device if same hardware ID is re-registered', async () => {
      const activeDev = {
        id: 'dev-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-pixel-8',
        status: 'active' as const,
      };
      mockDeviceRepo.getActiveDevice.mockResolvedValueOnce(activeDev);

      const res = await service.registerDevice(sampleContext, {
        deviceId: 'hw-pixel-8',
        deviceModel: 'Pixel 8',
        osName: 'Android',
        osVersion: '14',
        appVersion: '1.0.0',
      });

      expect(res.status).toBe('active');
      expect(res.requiresApproval).toBe(false);
      expect(mockDeviceRepo.createDevice).not.toHaveBeenCalled();
    });

    it('creates device as pending_approval and triggers workflow when active device already exists', async () => {
      const activeDev = {
        id: 'dev-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-pixel-8',
        deviceModel: 'Pixel 8',
        status: 'active' as const,
      };
      mockDeviceRepo.getActiveDevice.mockResolvedValueOnce(activeDev);
      mockDeviceRepo.createDevice.mockResolvedValueOnce({
        id: 'dev-2',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-iphone-15',
        deviceModel: 'iPhone 15',
        status: 'pending_approval',
      });

      const res = await service.registerDevice(sampleContext, {
        deviceId: 'hw-iphone-15',
        deviceModel: 'iPhone 15',
        osName: 'iOS',
        osVersion: '17',
        appVersion: '1.0.0',
      });

      expect(res.status).toBe('pending_approval');
      expect(res.requiresApproval).toBe(true);
      expect(res.workflowRequestId).toBe('wf-req-dev-1');
      expect(mockWorkflowService.submitRequest).toHaveBeenCalledWith(
        sampleContext,
        expect.objectContaining({
          definitionCode: 'device_change',
          entityType: 'device_change',
        }),
        undefined,
      );
    });
  });

  describe('Device Attestation Refresh', () => {
    it('successfully attests device with valid mock token', async () => {
      mockDeviceRepo.getDeviceByHardwareId.mockResolvedValueOnce({
        id: 'dev-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-pixel-8',
        status: 'active',
      });
      mockDeviceRepo.updateAttestation.mockResolvedValueOnce({ id: 'dev-1' });

      const res = await service.attestDevice(sampleContext, {
        deviceId: 'hw-pixel-8',
        platform: 'android',
        token: 'mock_valid_play_integrity_token',
      });

      expect(res.verified).toBe(true);
      expect(res.status).toBe('verified');
      expect(mockDeviceRepo.updateAttestation).toHaveBeenCalledWith(
        sampleContext.companyId,
        'dev-1',
        expect.any(Date),
        expect.any(Object),
        sampleContext.userId,
        undefined,
      );
    });
  });

  describe('Approve Device Change', () => {
    it('revokes previous active device and activates new device', async () => {
      mockDeviceRepo.getDeviceById.mockResolvedValueOnce({
        id: 'dev-2',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-iphone-15',
        status: 'pending_approval',
      });
      mockDeviceRepo.getActiveDevice.mockResolvedValueOnce({
        id: 'dev-1',
        companyId: sampleContext.companyId,
        employeeId: sampleContext.employeeId,
        deviceId: 'hw-pixel-8',
        status: 'active',
      });
      mockDeviceRepo.updateStatus
        .mockResolvedValueOnce({
          id: 'dev-1',
          deviceId: 'hw-pixel-8',
          status: 'revoked',
        })
        .mockResolvedValueOnce({
          id: 'dev-2',
          deviceId: 'hw-iphone-15',
          status: 'active',
        });

      const res = await service.approveDeviceChange(adminContext, 'hw-iphone-15');
      expect(res.status).toBe('active');
      expect(mockDeviceRepo.updateStatus).toHaveBeenCalledWith(
        adminContext.companyId,
        'dev-1',
        'revoked',
        adminContext.userId,
        undefined,
      );
    });
  });
});
