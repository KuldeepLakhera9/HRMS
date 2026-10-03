import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getAppPool, getOwnerPool, runMigrations, generateUuidV7, withTenant } from '@hrms/db';
import { OrgService, type RequestContext } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

describe('Sprint 1.2 P1-ORG-02 & P1-ORG-03: Work Locations & Org Chart Tests', () => {
  let appPool: pg.Pool;
  let ownerPool: pg.Pool;
  let orgService: OrgService;

  let tenantACompanyId: string;
  let tenantBCompanyId: string;
  let userAId: string;
  let userBId: string;

  let ceoId: string;
  let ctoId: string;
  let engineerId: string;

  beforeAll(async () => {
    ownerPool = getOwnerPool();
    await runMigrations(ownerPool);
    appPool = getAppPool();
    orgService = new OrgService();

    tenantACompanyId = generateUuidV7();
    tenantBCompanyId = generateUuidV7();
    userAId = generateUuidV7();
    userBId = generateUuidV7();

    ceoId = generateUuidV7();
    ctoId = generateUuidV7();
    engineerId = generateUuidV7();

    // Create companies
    await ownerPool.query(
      `INSERT INTO companies (id, name, legal_name, domain)
       VALUES ($1, 'Location Corp A', 'Location Corp A Ltd', 'loc-a.internal'),
              ($2, 'Location Corp B', 'Location Corp B Ltd', 'loc-b.internal')`,
      [tenantACompanyId, tenantBCompanyId],
    );

    // Create users
    await ownerPool.query(
      `INSERT INTO users (id, company_id, email, password_hash, status)
       VALUES ($1, $2, 'admin@loc-a.internal', 'hash', 'active'),
              ($3, $4, 'admin@loc-b.internal', 'hash', 'active')`,
      [userAId, tenantACompanyId, userBId, tenantBCompanyId],
    );

    // Create employees hierarchy in Tenant A for Org Chart test inside tenant context
    await withTenant(
      { companyId: tenantACompanyId, userId: userAId },
      async (_tx, client) => {
        await client.query(
          `INSERT INTO employees (
             id, company_id, emp_code, first_name, last_name, email_work,
             status, doj, job_effective_from, search_key, manager_id, reporting_path
           ) VALUES
           ($1, $2, 'EMP-001', 'Satya', 'Leader', 'satya@loc-a.internal', 'active', '2024-01-01', '2024-01-01', 'satya leader', NULL, '{}'),
           ($3, $2, 'EMP-002', 'Kevin', 'Tech', 'kevin@loc-a.internal', 'active', '2024-01-01', '2024-01-01', 'kevin tech', $1, ARRAY[$1]::uuid[]),
           ($4, $2, 'EMP-003', 'Ada', 'Dev', 'ada@loc-a.internal', 'active', '2024-01-01', '2024-01-01', 'ada dev', $3, ARRAY[$1, $3]::uuid[])`,
          [ceoId, tenantACompanyId, ctoId, engineerId],
        );
      },
      appPool,
    );
  });

  afterAll(async () => {
    await ownerPool.query('DELETE FROM employees WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM work_locations WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM users WHERE company_id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
    await ownerPool.query('DELETE FROM companies WHERE id IN ($1, $2)', [
      tenantACompanyId,
      tenantBCompanyId,
    ]);
  });

  function createContext(companyId: string, userId: string, permissions: string[] = []): RequestContext {
    return {
      companyId,
      userId,
      sessionId: generateUuidV7(),
      roles: ['super_admin'],
      permissions,
      requestId: generateUuidV7(),
      isAuthenticated: true,
    };
  }

  // --------------------------------------------------------------------------
  // P1-ORG-02: Work Locations CRUD & PostGIS Center
  // --------------------------------------------------------------------------
  it('creates, retrieves, updates, and deletes work locations with PostGIS geofence', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.ORG_LOCATION_MANAGE,
      PERMISSIONS.ORG_LOCATION_READ,
    ]);

    // 1. Create location with coordinates and radius
    const created = await orgService.createLocation(
      ctx,
      {
        name: 'Bengaluru Tech Park',
        code: 'BLR-01',
        address: {
          line1: 'Outer Ring Road, Bellandur',
          city: 'Bengaluru',
          state: 'Karnataka',
          country: 'India',
          postalCode: '560103',
        },
        timezone: 'Asia/Kolkata',
        latitude: 12.9279,
        longitude: 77.6778,
        radiusMeters: 250,
        active: true,
      },
      appPool,
    );

    expect(created.id).toBeDefined();
    expect(created.name).toBe('Bengaluru Tech Park');
    expect(created.code).toBe('BLR-01');
    expect(created.latitude).toBeCloseTo(12.9279, 4);
    expect(created.longitude).toBeCloseTo(77.6778, 4);
    expect(created.radiusMeters).toBe(250);

    // 2. Fetch by ID
    const fetched = await orgService.getLocation(ctx, created.id, appPool);
    expect(fetched.id).toBe(created.id);
    expect(fetched.address.city).toBe('Bengaluru');

    // 3. List locations
    const list = await orgService.listLocations(ctx, { active: true }, appPool);
    expect(list.some(l => l.id === created.id)).toBe(true);

    // 4. Update location
    const updated = await orgService.updateLocation(
      ctx,
      created.id,
      {
        name: 'Bengaluru HQ Campus',
        radiusMeters: 500,
      },
      appPool,
    );
    expect(updated.name).toBe('Bengaluru HQ Campus');
    expect(updated.radiusMeters).toBe(500);

    // 5. Delete location
    const deleted = await orgService.deleteLocation(ctx, created.id, appPool);
    expect(deleted).toBe(true);

    // 6. Deleted location cannot be found
    await expect(orgService.getLocation(ctx, created.id, appPool)).rejects.toThrow(
      'Work location not found',
    );
  });

  it('enforces tenant isolation for work locations', async () => {
    const ctxA = createContext(tenantACompanyId, userAId, [
      PERMISSIONS.ORG_LOCATION_MANAGE,
      PERMISSIONS.ORG_LOCATION_READ,
    ]);
    const ctxB = createContext(tenantBCompanyId, userBId, [
      PERMISSIONS.ORG_LOCATION_MANAGE,
      PERMISSIONS.ORG_LOCATION_READ,
    ]);

    const locationA = await orgService.createLocation(
      ctxA,
      {
        name: 'Mumbai Office',
        code: 'BOM-01',
        address: {
          line1: 'Bandra Kurla Complex',
          city: 'Mumbai',
          state: 'Maharashtra',
          country: 'India',
          postalCode: '400051',
        },
      },
      appPool,
    );

    // Tenant B cannot retrieve Tenant A's location
    await expect(orgService.getLocation(ctxB, locationA.id, appPool)).rejects.toThrow(
      'Work location not found',
    );

    // Tenant B cannot delete Tenant A's location
    await expect(orgService.deleteLocation(ctxB, locationA.id, appPool)).rejects.toThrow(
      'Work location not found',
    );
  });

  // --------------------------------------------------------------------------
  // P1-ORG-03: Org Chart Hierarchy & Search
  // --------------------------------------------------------------------------
  it('retrieves leadership root and lazy loads child nodes with accurate report counts', async () => {
    const ctx = createContext(tenantACompanyId, userAId, [PERMISSIONS.ORG_CHART_READ]);

    // 1. Fetch root nodes (parentId is null)
    const roots = await orgService.getOrgChart(ctx, null, appPool);
    expect(roots.length).toBe(1);
    expect(roots[0]!.id).toBe(ceoId);
    expect(roots[0]!.fullName).toBe('Satya Leader');
    expect(roots[0]!.directReportsCount).toBe(1); // Kevin reports to Satya

    // 2. Fetch children of CEO (Kevin)
    const ctoChildren = await orgService.getOrgChart(ctx, ceoId, appPool);
    expect(ctoChildren.length).toBe(1);
    expect(ctoChildren[0]!.id).toBe(ctoId);
    expect(ctoChildren[0]!.fullName).toBe('Kevin Tech');
    expect(ctoChildren[0]!.directReportsCount).toBe(1); // Ada reports to Kevin

    // 3. Fetch children of CTO (Ada)
    const devChildren = await orgService.getOrgChart(ctx, ctoId, appPool);
    expect(devChildren.length).toBe(1);
    expect(devChildren[0]!.id).toBe(engineerId);
    expect(devChildren[0]!.fullName).toBe('Ada Dev');
    expect(devChildren[0]!.directReportsCount).toBe(0); // Leaf node
  });

  it('searches employees in org chart and respects tenant isolation', async () => {
    const ctxA = createContext(tenantACompanyId, userAId, [PERMISSIONS.ORG_CHART_READ]);
    const ctxB = createContext(tenantBCompanyId, userBId, [PERMISSIONS.ORG_CHART_READ]);

    // Search in Tenant A
    const resultsA = await orgService.searchOrgChart(ctxA, 'Ada', appPool);
    expect(resultsA.length).toBe(1);
    expect(resultsA[0]!.id).toBe(engineerId);
    expect(resultsA[0]!.empCode).toBe('EMP-003');

    // Tenant B searches for Ada -> must return empty
    const resultsB = await orgService.searchOrgChart(ctxB, 'Ada', appPool);
    expect(resultsB.length).toBe(0);
  });
});
