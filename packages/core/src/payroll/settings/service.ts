import { Database, PayrollSetting, LegalEntity, NewPayrollSetting } from '@hrms/db';
import { ForbiddenError, PERMISSIONS } from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { PayrollSettingsRepository } from './repository.js';

export class PayrollSettingsService {
  constructor(private repo = new PayrollSettingsRepository()) {}

  async getSettingsAndEntities(
    ctx: RequestContext,
    db: Database,
  ): Promise<{ settings: PayrollSetting | null; legalEntities: LegalEntity[] }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SETTINGS_READ)) {
      throw new ForbiddenError('Permission denied: payroll.settings.read required');
    }

    const settings = await this.repo.getSettings(db, ctx.companyId);
    const legalEntities = await this.repo.listLegalEntities(db, ctx.companyId);

    return { settings, legalEntities };
  }

  async saveSettings(
    ctx: RequestContext,
    db: Database,
    data: {
      legalEntityId?: string;
      payCycle?: 'monthly';
      payDay?: number;
      paidDaysBasis?: 'calendar' | 'fixed_30' | 'working_days';
      prorationMode?: 'prorate_earnings' | 'deduct_lop';
      fyStartMonth?: number;
      labourCodeWages?: { enabled: boolean; floorPct: number };
      pfEnabled?: boolean;
      esiEnabled?: boolean;
      ptEnabled?: boolean;
      lwfEnabled?: boolean;
      negativeNetPolicy?: 'block' | 'hold' | 'carry_forward';
    },
  ): Promise<PayrollSetting> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_SETTINGS_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.settings.manage required');
    }

    const existing = await this.repo.getSettings(db, ctx.companyId);

    if (existing) {
      return this.repo.updateSettings(db, ctx.companyId, existing.id, {
        ...data,
        updatedBy: ctx.userId ?? existing.updatedBy,
      });
    }

    let legalEntityId = data.legalEntityId;
    if (!legalEntityId) {
      const entities = await this.repo.listLegalEntities(db, ctx.companyId);
      if (entities.length > 0) {
        legalEntityId = entities[0]!.id;
      } else {
        const newEntity = await this.repo.createLegalEntity(db, {
          companyId: ctx.companyId,
          name: 'Primary Legal Entity',
          pan: 'AAAAA0000A',
          tan: 'AAAA00000A',
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
        legalEntityId = newEntity.id;
      }
    }

    const newSetting: NewPayrollSetting = {
      companyId: ctx.companyId,
      legalEntityId,
      payCycle: data.payCycle ?? 'monthly',
      payDay: data.payDay ?? 30,
      paidDaysBasis: data.paidDaysBasis ?? 'calendar',
      prorationMode: data.prorationMode ?? 'prorate_earnings',
      fyStartMonth: data.fyStartMonth ?? 4,
      labourCodeWages: data.labourCodeWages ?? { enabled: true, floorPct: 50 },
      pfEnabled: data.pfEnabled ?? true,
      esiEnabled: data.esiEnabled ?? true,
      ptEnabled: data.ptEnabled ?? true,
      lwfEnabled: data.lwfEnabled ?? true,
      negativeNetPolicy: data.negativeNetPolicy ?? 'block',
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    };

    return this.repo.createSettings(db, newSetting);
  }
}
