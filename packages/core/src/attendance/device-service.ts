import pg from 'pg';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { can } from '../routing/authorization.js';
import { AuditService } from '../audit/service.js';
import { DeviceRepository } from './device-repository.js';
import {
  type AttestationVerifier,
  type AttestationResult,
  getAttestationVerifier,
} from './attestation.js';
import { WorkflowService } from '../workflow/service.js';
import type { EmployeeDevice } from '@hrms/db';
import type { RegisterDeviceInput, AttestDeviceInput } from './device-validation.js';

export interface RegisterDeviceResult {
  device: EmployeeDevice;
  status: 'active' | 'pending_approval' | 'revoked';
  requiresApproval: boolean;
  workflowRequestId?: string | undefined;
}

export class DeviceService {
  private deviceRepo: DeviceRepository;
  private auditService: AuditService;
  private workflowService: WorkflowService;
  private verifier: AttestationVerifier;

  constructor(
    deviceRepo?: DeviceRepository,
    auditService?: AuditService,
    workflowService?: WorkflowService,
    verifier?: AttestationVerifier,
  ) {
    this.deviceRepo = deviceRepo ?? new DeviceRepository();
    this.auditService = auditService ?? new AuditService();
    this.workflowService = workflowService ?? new WorkflowService();
    this.verifier = verifier ?? getAttestationVerifier();
  }

  /**
   * Registers a mobile device for an employee.
   * If an active device already exists, marks the new device as 'pending_approval'
   * and submits a device_change workflow request to HR.
   */
  async registerDevice(
    ctx: RequestContext,
    input: RegisterDeviceInput,
    poolOverride?: pg.Pool,
  ): Promise<RegisterDeviceResult> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to register device.');
    }

    const employeeId = input.employeeId ?? ctx.employeeId;
    if (!employeeId) {
      throw new ValidationError('Employee ID is required for device registration.');
    }

    // Only allow self or admins with permissions
    if (input.employeeId && input.employeeId !== ctx.employeeId) {
      if (!can(ctx, PERMISSIONS.ATTENDANCE_DEVICE_MANAGE)) {
        throw new ForbiddenError('Permission denied: cannot register device for another employee.');
      }
    }

    // 1. Check existing active device for employee
    const activeDevice = await this.deviceRepo.getActiveDevice(
      ctx.companyId,
      employeeId,
      poolOverride,
    );

    // If same device is already active, return it
    if (activeDevice && activeDevice.deviceId === input.deviceId) {
      return {
        device: activeDevice,
        status: 'active',
        requiresApproval: false,
      };
    }

    // If NO active device exists, activate immediately
    if (!activeDevice) {
      const newDevice = await this.deviceRepo.createDevice(
        ctx.companyId,
        {
          employeeId,
          deviceId: input.deviceId,
          deviceModel: input.deviceModel,
          osName: input.osName,
          osVersion: input.osVersion,
          appVersion: input.appVersion,
          status: 'active',
          createdBy: ctx.userId ?? 'system',
        },
        poolOverride,
      );

      await this.auditService.recordEvent(ctx, {
        action: 'attendance.device.registered',
        entity: 'employee_devices',
        entityId: newDevice.id,
        after: {
          employeeId,
          deviceId: input.deviceId,
          status: 'active',
        },
      });

      return {
        device: newDevice,
        status: 'active',
        requiresApproval: false,
      };
    }

    // If another device is active, submit device replacement request via workflow
    const pendingDevice = await this.deviceRepo.createDevice(
      ctx.companyId,
      {
        employeeId,
        deviceId: input.deviceId,
        deviceModel: input.deviceModel,
        osName: input.osName,
        osVersion: input.osVersion,
        appVersion: input.appVersion,
        status: 'pending_approval',
        createdBy: ctx.userId ?? 'system',
      },
      poolOverride,
    );

    let workflowRequestId: string | undefined;
    try {
      const wfResult = await this.workflowService.submitRequest(
        ctx,
        {
          definitionCode: 'device_change',
          entityType: 'device_change',
          entityId: pendingDevice.id,
          payload: {
            employeeId,
            currentDeviceId: activeDevice.deviceId,
            currentDeviceModel: activeDevice.deviceModel,
            newDeviceId: input.deviceId,
            newDeviceModel: input.deviceModel,
          },
        },
        poolOverride,
      );
      workflowRequestId = wfResult.requestId;
    } catch {
      // If workflow definition does not exist in dev, device remains pending_approval
    }

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.device.replacement_requested',
      entity: 'employee_devices',
      entityId: pendingDevice.id,
      after: {
        employeeId,
        oldDeviceId: activeDevice.deviceId,
        newDeviceId: input.deviceId,
        status: 'pending_approval',
        workflowRequestId,
      },
    });

    return {
      device: pendingDevice,
      status: 'pending_approval',
      requiresApproval: true,
      workflowRequestId,
    };
  }

  /**
   * Refreshes device attestation.
   * Called daily by mobile client; not on punch hot path.
   */
  async attestDevice(
    ctx: RequestContext,
    input: AttestDeviceInput,
    poolOverride?: pg.Pool,
  ): Promise<AttestationResult> {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required to attest device.');
    }

    const employeeId = ctx.employeeId;
    if (!employeeId) {
      throw new ValidationError('Employee ID is required to attest device.');
    }

    const device = await this.deviceRepo.getDeviceByHardwareId(
      ctx.companyId,
      employeeId,
      input.deviceId,
      poolOverride,
    );

    if (!device) {
      throw new NotFoundError('Device', input.deviceId);
    }

    let result: AttestationResult;
    if (input.platform === 'android') {
      result = await this.verifier.verifyPlayIntegrity(input.token, input.packageName);
    } else {
      result = await this.verifier.verifyAppAttest(
        input.keyId ?? '',
        input.token,
        input.challenge ?? '',
      );
    }

    if (result.verified) {
      await this.deviceRepo.updateAttestation(
        ctx.companyId,
        device.id,
        new Date(),
        result.details ?? {},
        ctx.userId ?? 'system',
        poolOverride,
      );
    }

    return result;
  }

  /**
   * Approves a pending device change, revoking the previous device.
   * Requires permission: org.employee.manage.
   */
  async approveDeviceChange(
    ctx: RequestContext,
    pendingDeviceId: string,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice> {
    if (!can(ctx, PERMISSIONS.ATTENDANCE_DEVICE_MANAGE)) {
      throw new ForbiddenError('Permission denied: attendance.device.manage required to approve device change.');
    }

    let pendingDevice = await this.deviceRepo.getDeviceById(
      ctx.companyId,
      pendingDeviceId,
      poolOverride,
    );

    if (!pendingDevice && ctx.employeeId) {
      pendingDevice = await this.deviceRepo.getDeviceByHardwareId(
        ctx.companyId,
        ctx.employeeId,
        pendingDeviceId,
        poolOverride,
      );
    }

    if (!pendingDevice) {
      throw new NotFoundError('Device', pendingDeviceId);
    }

    // Get active device to revoke
    const activeDevice = await this.deviceRepo.getActiveDevice(
      ctx.companyId,
      pendingDevice.employeeId,
      poolOverride,
    );

    if (activeDevice && activeDevice.id !== pendingDevice.id) {
      await this.deviceRepo.updateStatus(
        ctx.companyId,
        activeDevice.id,
        'revoked',
        ctx.userId ?? 'system',
        poolOverride,
      );
    }

    const approvedDevice = await this.deviceRepo.updateStatus(
      ctx.companyId,
      pendingDevice.id,
      'active',
      ctx.userId ?? 'system',
      poolOverride,
    );

    await this.auditService.recordEvent(ctx, {
      action: 'attendance.device.change_approved',
      entity: 'employee_devices',
      entityId: approvedDevice.id,
      before: activeDevice ? { deviceId: activeDevice.deviceId, status: 'revoked' } : undefined,
      after: { deviceId: approvedDevice.deviceId, status: 'active' },
    });

    return approvedDevice;
  }

  /**
   * Retrieves the current device for the authenticated employee.
   */
  async getMyDevice(
    ctx: RequestContext,
    poolOverride?: pg.Pool,
  ): Promise<EmployeeDevice | null> {
    if (!ctx.isAuthenticated || !ctx.employeeId) {
      throw new UnauthorizedError('Authentication required.');
    }

    return this.deviceRepo.getActiveDevice(ctx.companyId, ctx.employeeId, poolOverride);
  }
}
