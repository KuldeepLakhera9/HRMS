import crypto from 'node:crypto';
import type pg from 'pg';
import { UnauthorizedError } from '@hrms/shared';
import type { RequestContext } from '../routing/context.js';
import { AuditService } from '../audit/service.js';
import { BiometricRepository } from './biometric-repository.js';
import type { BiometricIngestBatchInput } from './biometric-validation.js';

/**
 * Checks if an IPv4 address belongs to an IPv4 CIDR range or wildcard.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!cidr || cidr === '*' || cidr === '0.0.0.0/0') return true;

  // Handle comma-separated multiple CIDRs
  const cidrList = cidr.split(',').map(c => c.trim());
  for (const range of cidrList) {
    if (range === ip) return true;

    const [subnet, prefixStr] = range.split('/');
    if (!subnet) continue;
    const prefix = prefixStr ? parseInt(prefixStr, 10) : 32;

    const ipParts = ip.split('.').map(p => parseInt(p, 10));
    const subnetParts = subnet.split('.').map(p => parseInt(p, 10));

    if (ipParts.length !== 4 || subnetParts.length !== 4 || isNaN(prefix)) {
      continue;
    }

    const ipNum = ((ipParts[0]! << 24) | (ipParts[1]! << 16) | (ipParts[2]! << 8) | ipParts[3]!) >>> 0;
    const subnetNum = ((subnetParts[0]! << 24) | (subnetParts[1]! << 16) | (subnetParts[2]! << 8) | subnetParts[3]!) >>> 0;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

    if ((ipNum & mask) === (subnetNum & mask)) {
      return true;
    }
  }

  return false;
}

/**
 * Verifies HMAC-SHA256 signature using timing-safe comparison.
 */
export function verifyHmacSignature(rawBody: string, hmacSecret: string, signature: string): boolean {
  if (!signature || !hmacSecret) return false;

  const expected = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export class BiometricService {
  private repo: BiometricRepository;
  private auditService: AuditService;

  constructor(repo?: BiometricRepository, auditService?: AuditService) {
    this.repo = repo ?? new BiometricRepository();
    this.auditService = auditService ?? new AuditService();
  }

  /**
   * Ingests a batch of biometric attendance punches (P2-BIO-01).
   * Verifies hardware HMAC signature, enforces allowed IP CIDRs, maps biometric user IDs,
   * quarantines unmapped punches, and idempotently records attendance punches.
   * Query budget: <= 3 + punches.length
   */
  async ingestBatch(
    ctx: RequestContext,
    input: BiometricIngestBatchInput,
    options?: {
      clientIp?: string;
      signature?: string;
      rawBody?: string;
    },
    poolOverride?: pg.Pool,
  ): Promise<{
    ingestedCount: number;
    quarantinedCount: number;
    duplicateCount: number;
    totalProcessed: number;
  }> {
    // 1. Authenticate Device
    const device = await this.repo.findDeviceByDeviceId(ctx.companyId, input.deviceId, poolOverride);
    if (!device) {
      throw new UnauthorizedError(`Biometric device '${input.deviceId}' is not registered for this company.`);
    }

    if (!device.isActive) {
      throw new UnauthorizedError(`Biometric device '${input.deviceId}' has been deactivated.`);
    }

    // 2. Validate IP CIDR if client IP is present
    if (options?.clientIp && device.ipCidr) {
      const isAllowed = isIpInCidr(options.clientIp, device.ipCidr);
      if (!isAllowed) {
        throw new UnauthorizedError(`Client IP '${options.clientIp}' is not permitted for device '${input.deviceId}'.`);
      }
    }

    // 3. Validate HMAC signature if provided
    if (options?.signature && options?.rawBody) {
      const isValidSig = verifyHmacSignature(options.rawBody, device.hmacSecret, options.signature);
      if (!isValidSig) {
        throw new UnauthorizedError('Invalid HMAC signature for biometric device payload.');
      }
    }

    let ingestedCount = 0;
    let quarantinedCount = 0;
    let duplicateCount = 0;

    const auditUserId =
      ctx.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.userId)
        ? ctx.userId
        : '00000000-0000-0000-0000-000000000000';

    // 4. Process Batch Punches
    for (const punch of input.punches) {
      const punchDate = new Date(punch.punchTime);
      const workDate = punchDate.toISOString().slice(0, 10);
      const punchType = punch.punchType === 'auto' ? 'in' : punch.punchType;

      // Look up employee by biometric ID
      const emp = await this.repo.findEmployeeByBiometricId(ctx.companyId, punch.biometricUserId, poolOverride);

      if (!emp) {
        // Quarantine unmapped biometric record
        await this.repo.insertQuarantine(
          ctx.companyId,
          {
            deviceId: device.deviceId,
            biometricUserId: punch.biometricUserId,
            punchTime: punchDate,
            punchType: punch.punchType,
            rawPayload: {
              ...punch,
              receivedAt: new Date().toISOString(),
            },
            errorReason: 'UNMAPPED_BIOMETRIC_USER_ID',
            createdBy: auditUserId,
          },
          poolOverride,
        );
        quarantinedCount++;
      } else {
        // Record attendance punch idempotently
        const idempotencyKey = `bio:${device.deviceId}:${punch.rawRecordId || punch.punchTime}`;
        const res = await this.repo.insertBiometricPunch(
          ctx.companyId,
          {
            employeeId: emp.id,
            punchTime: punchDate,
            punchType,
            workDate,
            deviceId: device.deviceId,
            locationId: device.locationId,
            idempotencyKey,
            createdBy: auditUserId,
          },
          poolOverride,
        );

        if (res.isDuplicate) {
          duplicateCount++;
        } else {
          ingestedCount++;
        }
      }
    }

    // 5. Update Device Sync Timestamp
    await this.repo.updateDeviceSync(ctx.companyId, device.deviceId, poolOverride);

    // 6. Record Audit Event
    await this.auditService.recordEvent(
      ctx,
      {
        action: 'attendance.biometric.ingested',
        entity: 'biometric_device',
        entityId: device.id,
        after: {
          deviceId: device.deviceId,
          ingestedCount,
          quarantinedCount,
          duplicateCount,
          totalPunches: input.punches.length,
        },
        poolOverride,
      },
    );

    return {
      ingestedCount,
      quarantinedCount,
      duplicateCount,
      totalProcessed: input.punches.length,
    };
  }

  /**
   * Retrieves quarantined biometric punches for review.
   */
  async listQuarantine(ctx: RequestContext, limit = 50, poolOverride?: pg.Pool) {
    if (!ctx.isAuthenticated) {
      throw new UnauthorizedError('Authentication required.');
    }
    return this.repo.listQuarantine(ctx.companyId, limit, poolOverride);
  }
}
