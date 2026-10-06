import { ForbiddenError, ValidationError } from '@hrms/shared';

export interface MakerCheckerEntity {
  id: string;
  companyId: string;
  status: string;
  makerId?: string | null;
  checkerId?: string | null;
  createdBy?: string | null;
}

export interface SoDPolicy {
  strict?: boolean;
}

/**
 * Asserts segregation of duties for maker-checker approval actions.
 * Throws ForbiddenError if the approver is the maker or creator of the record.
 */
export function assertSegregationOfDuties(
  makerOrCreatorId: string | null | undefined,
  approverUserId: string,
  entityName = 'record',
  policy: SoDPolicy = { strict: true },
): void {
  if (policy.strict === false) {
    // Demo/test mode relaxed SoD
    return;
  }

  if (!makerOrCreatorId) {
    return;
  }

  if (makerOrCreatorId === approverUserId) {
    throw new ForbiddenError(
      `Segregation of duties violation: Maker cannot approve their own ${entityName}`,
    );
  }
}

/**
 * Validates that an entity is in a valid state for approval.
 */
export function assertCanApproveStatus(
  currentStatus: string,
  allowedStatuses: string[] = ['draft', 'pending_approval'],
  entityName = 'record',
): void {
  if (!allowedStatuses.includes(currentStatus)) {
    throw new ValidationError(
      `Cannot approve ${entityName} in status '${currentStatus}' (must be one of: ${allowedStatuses.join(', ')})`,
    );
  }
}
