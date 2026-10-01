import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { PERMISSIONS, ALL_PERMISSIONS } from '@hrms/shared';
import { getOwnerPool } from './client.js';
import { generateUuidV7 } from './id.js';

const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

export interface SeedResult {
  companyId: string;
  companyName: string;
  adminEmail: string;
  rolesSeeded: number;
  departmentsSeeded: number;
  designationsSeeded: number;
}

export async function seedDatabase(poolOverride?: pg.Pool): Promise<SeedResult> {
  const pool = poolOverride ?? getOwnerPool();
  const client = await pool.connect();

  try {
    console.info('[Seeding Engine] Starting database seed as hrms_owner...');
    await client.query('BEGIN');

    // 1. Seed or resolve default Company
    const domain = 'orghub.internal';
    const compCheck = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM companies WHERE domain = $1',
      [domain],
    );

    let companyId: string;
    let companyName: string;

    if (compCheck.rows.length > 0 && compCheck.rows[0]) {
      companyId = compCheck.rows[0].id;
      companyName = compCheck.rows[0].name;
      console.info(`[Seeding Engine] Found existing company: ${companyName} (${companyId})`);
    } else {
      companyId = generateUuidV7();
      companyName = 'OrgHub Tech Ltd';
      await client.query(
        `INSERT INTO companies (
          id, name, legal_name, domain, timezone, currency, fiscal_year_start_month, settings, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
        [
          companyId,
          companyName,
          'OrgHub Technologies Private Limited',
          domain,
          'Asia/Kolkata',
          'INR',
          4,
          JSON.stringify({}),
        ],
      );
      console.info(`[Seeding Engine] Created company: ${companyName} (${companyId})`);
    }

    // Set transaction-local company context to satisfy Row Level Security (RLS)
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

    // 2. Define System Roles & Permission Mappings
    const SYSTEM_ROLES = [
      {
        name: 'super_admin',
        description: 'Unrestricted system super administrator with full platform access',
        requiresMfa: true,
        permissions: ALL_PERMISSIONS.map(p => ({ key: p, scope: 'company' as const })),
      },
      {
        name: 'admin',
        description: 'Organization administrator managing users, roles, hierarchy, and audit logs',
        requiresMfa: true,
        permissions: [
          { key: PERMISSIONS.AUTH_USER_READ, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_USER_CREATE, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_USER_UPDATE, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_USER_DEACTIVATE, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_USER_RESET_MFA, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_SESSION_READ, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_SESSION_REVOKE, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_ROLE_READ, scope: 'company' as const },
          { key: PERMISSIONS.AUTH_ROLE_ASSIGN, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COMPANY_UPDATE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DESIGNATION_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DESIGNATION_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_GRADE_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_GRADE_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COSTCENTER_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COSTCENTER_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_LOCATION_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_LOCATION_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CUSTOMFIELD_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CUSTOMFIELD_MANAGE, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CHART_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_CREATE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_UPDATE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_HISTORY_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.AUDIT_LOG_READ, scope: 'company' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
      {
        name: 'hr_manager',
        description: 'Human resources manager managing employees, hierarchy, documents, and approvals',
        requiresMfa: true,
        permissions: [
          { key: PERMISSIONS.AUTH_USER_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DESIGNATION_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_GRADE_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COSTCENTER_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_LOCATION_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CHART_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_CREATE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_UPDATE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_EXPORT, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_IMPORT, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_HISTORY_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_VERIFY, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_CREATE, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_APPROVE, scope: 'company' as const },
          { key: PERMISSIONS.AUDIT_LOG_READ, scope: 'company' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
      {
        name: 'payroll_manager',
        description: 'Payroll manager for compensation, salary records, and tax filings',
        requiresMfa: true,
        permissions: [
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_COSTCENTER_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_VIEW_SENSITIVE, scope: 'company' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
      {
        name: 'employee',
        description: 'Standard employee with self-service rights for profile, documents, and change requests',
        requiresMfa: false,
        permissions: [
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DESIGNATION_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CHART_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'self' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_READ, scope: 'self' as const },
          { key: PERMISSIONS.EMPLOYEE_DOCUMENT_UPLOAD, scope: 'self' as const },
          { key: PERMISSIONS.EMPLOYEE_CHANGEREQUEST_CREATE, scope: 'self' as const },
          { key: PERMISSIONS.AUDIT_LOG_READ_OWN, scope: 'self' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
      {
        name: 'contractor',
        description: 'Contractor with limited read and self-service access',
        requiresMfa: false,
        permissions: [
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'self' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
      {
        name: 'auditor',
        description: 'External or internal auditor with read-only audit log and employee inspection rights',
        requiresMfa: true,
        permissions: [
          { key: PERMISSIONS.ORG_COMPANY_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_DEPARTMENT_READ, scope: 'company' as const },
          { key: PERMISSIONS.ORG_CHART_READ, scope: 'company' as const },
          { key: PERMISSIONS.EMPLOYEE_PROFILE_READ, scope: 'company' as const },
          { key: PERMISSIONS.AUDIT_LOG_READ, scope: 'company' as const },
          { key: PERMISSIONS.NOTIFICATION_PREFERENCE_MANAGE, scope: 'self' as const },
        ],
      },
    ];

    const roleMap = new Map<string, string>();

    // 3. Upsert Roles & Permissions
    for (const roleDef of SYSTEM_ROLES) {
      const roleId = generateUuidV7();
      const roleRes = await client.query<{ id: string }>(
        `INSERT INTO roles (id, company_id, name, description, is_system, requires_mfa, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, $5, 1, now(), now())
         ON CONFLICT (company_id, name) WHERE deleted_at IS NULL
         DO UPDATE SET
           description = EXCLUDED.description,
           requires_mfa = EXCLUDED.requires_mfa,
           is_system = true,
           updated_at = now()
         RETURNING id`,
        [roleId, companyId, roleDef.name, roleDef.description, roleDef.requiresMfa],
      );

      const resolvedRoleId = roleRes.rows[0]!.id;
      roleMap.set(roleDef.name, resolvedRoleId);

      // Upsert role permissions
      for (const perm of roleDef.permissions) {
        const permId = generateUuidV7();
        await client.query(
          `INSERT INTO role_permissions (id, company_id, role_id, permission_key, scope, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, now(), now())
           ON CONFLICT (company_id, role_id, permission_key)
           DO UPDATE SET scope = EXCLUDED.scope, updated_at = now()`,
          [permId, companyId, resolvedRoleId, perm.key, perm.scope],
        );
      }
    }
    console.info(`[Seeding Engine] Seeded ${SYSTEM_ROLES.length} system roles and permissions.`);

    // 4. Seed First Super Admin User
    const adminEmail = 'admin@orghub.internal';
    const rawAdminPass = 'Admin@12345678';
    const passwordHash = await hash(rawAdminPass, ARGON2_OPTIONS);

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO users (id, company_id, email, password_hash, status, mfa_enabled, perm_version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', false, 1, now(), now())
       ON CONFLICT (company_id, email) WHERE deleted_at IS NULL
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         status = 'active',
         updated_at = now()
       RETURNING id`,
      [generateUuidV7(), companyId, adminEmail, passwordHash],
    );

    const adminUserId = userRes.rows[0]!.id;

    // Assign super_admin role
    const superAdminRoleId = roleMap.get('super_admin')!;
    await client.query(
      `INSERT INTO user_roles (id, company_id, user_id, role_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (company_id, user_id, role_id) DO NOTHING`,
      [generateUuidV7(), companyId, adminUserId, superAdminRoleId],
    );
    console.info(`[Seeding Engine] Seeded super admin: ${adminEmail} (password: ${rawAdminPass})`);

    // 5. Seed Core Organization Hierarchy & Reference Entities
    const departmentDefinitions = [
      { name: 'Executive Leadership', code: 'EXEC', parentCode: null },
      { name: 'Engineering', code: 'ENG', parentCode: null },
      { name: 'Core Platform', code: 'ENG-PLAT', parentCode: 'ENG' },
      { name: 'Web Experience', code: 'ENG-WEB', parentCode: 'ENG' },
      { name: 'Human Resources', code: 'HR', parentCode: null },
      { name: 'Finance & Operations', code: 'FIN', parentCode: null },
      { name: 'Product Management', code: 'PROD', parentCode: null },
    ];

    const deptMap = new Map<string, string>();

    // Pass 1: Root departments
    for (const d of departmentDefinitions.filter(dep => dep.parentCode === null)) {
      const deptId = generateUuidV7();
      const res = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, parent_id, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, true, now(), now())
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()
         RETURNING id`,
        [deptId, companyId, d.name, d.code],
      );
      deptMap.set(d.code, res.rows[0]!.id);
    }

    // Pass 2: Child departments
    for (const d of departmentDefinitions.filter(dep => dep.parentCode !== null)) {
      const parentId = deptMap.get(d.parentCode!)!;
      const deptId = generateUuidV7();
      const res = await client.query<{ id: string }>(
        `INSERT INTO departments (id, company_id, name, code, parent_id, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), now())
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, active = true, updated_at = now()
         RETURNING id`,
        [deptId, companyId, d.name, d.code, parentId],
      );
      deptMap.set(d.code, res.rows[0]!.id);
    }

    // Designations
    const designations = [
      { name: 'Chief Technology Officer', code: 'CTO' },
      { name: 'Principal Software Engineer', code: 'PR-ENG' },
      { name: 'Staff Software Engineer', code: 'STF-ENG' },
      { name: 'Senior Software Engineer', code: 'SR-ENG' },
      { name: 'Software Engineer', code: 'SE' },
      { name: 'Engineering Manager', code: 'EM' },
      { name: 'Head of Human Resources', code: 'HR-DIR' },
      { name: 'HR Generalist', code: 'HR-GEN' },
      { name: 'Finance Director', code: 'FIN-DIR' },
      { name: 'Senior Financial Analyst', code: 'FIN-ANL' },
      { name: 'Principal Product Manager', code: 'PR-PM' },
    ];

    for (const des of designations) {
      await client.query(
        `INSERT INTO designations (id, company_id, name, code, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, now(), now())
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()`,
        [generateUuidV7(), companyId, des.name, des.code],
      );
    }

    // Grades
    const grades = [
      { name: 'L1 - Associate', code: 'L1', level: 1 },
      { name: 'L2 - Mid-Level', code: 'L2', level: 2 },
      { name: 'L3 - Senior', code: 'L3', level: 3 },
      { name: 'L4 - Staff / Lead', code: 'L4', level: 4 },
      { name: 'L5 - Principal / Director', code: 'L5', level: 5 },
      { name: 'EXEC - Executive', code: 'EXEC', level: 6 },
    ];

    for (const gr of grades) {
      await client.query(
        `INSERT INTO grades (id, company_id, name, code, level, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, now(), now())
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level, active = true, updated_at = now()`,
        [generateUuidV7(), companyId, gr.name, gr.code, gr.level],
      );
    }

    // Cost Centers
    const costCenters = [
      { name: 'Engineering R&D', code: 'CC-ENG' },
      { name: 'Product Strategy', code: 'CC-PROD' },
      { name: 'Human Capital', code: 'CC-HR' },
      { name: 'Finance & Administration', code: 'CC-GNA' },
    ];

    for (const cc of costCenters) {
      await client.query(
        `INSERT INTO cost_centers (id, company_id, name, code, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, true, now(), now())
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()`,
        [generateUuidV7(), companyId, cc.name, cc.code],
      );
    }

    await client.query('COMMIT');
    console.info('[Seeding Engine] Database seeding completed successfully.');

    return {
      companyId,
      companyName,
      adminEmail,
      rolesSeeded: SYSTEM_ROLES.length,
      departmentsSeeded: departmentDefinitions.length,
      designationsSeeded: designations.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Seeding Engine] Failed to seed database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Auto-run when executed directly via CLI
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .then(res => {
      console.info('Seed finished:', res);
      process.exit(0);
    })
    .catch(err => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
