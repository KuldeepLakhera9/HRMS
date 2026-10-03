import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, type TestDatabaseContext } from '../helpers/db-test-helper.js';
import { withTenant, generateUuidV7 } from '@hrms/db';

describe('Sprint 1.2 Core Schema, RLS & Composite FK Verification', () => {
  let db: TestDatabaseContext;
  let companyAId: string;
  let companyBId: string;

  beforeAll(async () => {
    db = await setupTestDatabase();
    companyAId = await db.createCompany('Alpha Corp', `alpha-${generateUuidV7()}.corp`);
    companyBId = await db.createCompany('Beta Corp', `beta-${generateUuidV7()}.corp`);
  });

  afterAll(async () => {
    await db.close();
  });

  it('proves RLS on work_locations, employees, employee_history, and files', async () => {
    const locAId = generateUuidV7();
    const empAId = generateUuidV7();
    const histAId = generateUuidV7();
    const fileAId = generateUuidV7();

    // 1. Insert records in Company A inside tenant context
    await withTenant({ companyId: companyAId, userId: empAId }, async (_tx, client) => {
      await client.query(
        `INSERT INTO work_locations (id, company_id, name, code, timezone)
         VALUES ($1, $2, 'HQ Alpha', 'LOC-A', 'Asia/Kolkata')`,
        [locAId, companyAId],
      );

      await client.query(
        `INSERT INTO employees (id, company_id, emp_code, first_name, last_name, email_work, doj, status, search_key, location_id)
         VALUES ($1, $2, 'EMP-A1', 'Alice', 'Smith', 'alice@alpha.corp', '2026-01-01', 'active', 'alice smith emp-a1', $3)`,
        [empAId, companyAId, locAId],
      );

      await client.query(
        `INSERT INTO employee_history (id, company_id, employee_id, field, effective_from, changed_by)
         VALUES ($1, $2, $3, 'designation', '2026-01-01', $3)`,
        [histAId, companyAId, empAId],
      );

      const fileKey = `${companyAId}/doc1-${generateUuidV7()}.pdf`;
      await client.query(
        `INSERT INTO files (id, company_id, bucket, object_key, original_name, mime, size_bytes, owner_type, owner_id, uploaded_by)
         VALUES ($1, $2, 'hrms-documents', $3, 'doc1.pdf', 'application/pdf', 1024, 'employee', $4, $4)`,
        [fileAId, companyAId, fileKey, empAId],
      );
    }, db.appPool);

    // 2. Query as hrms_app WITHOUT tenant context -> RLS must return 0 rows
    const noTenantLoc = await db.appPool.query('SELECT * FROM work_locations WHERE id = $1', [locAId]);
    expect(noTenantLoc.rows.length).toBe(0);

    const noTenantEmp = await db.appPool.query('SELECT * FROM employees WHERE id = $1', [empAId]);
    expect(noTenantEmp.rows.length).toBe(0);

    const noTenantHist = await db.appPool.query('SELECT * FROM employee_history WHERE id = $1', [histAId]);
    expect(noTenantHist.rows.length).toBe(0);

    const noTenantFile = await db.appPool.query('SELECT * FROM files WHERE id = $1', [fileAId]);
    expect(noTenantFile.rows.length).toBe(0);

    // 3. Query as hrms_app WITH Company B tenant context -> RLS must return 0 rows
    await withTenant({ companyId: companyBId, userId: generateUuidV7() }, async (_tx, client) => {
      const resLoc = await client.query('SELECT * FROM work_locations WHERE id = $1', [locAId]);
      expect(resLoc.rows.length).toBe(0);

      const resEmp = await client.query('SELECT * FROM employees WHERE id = $1', [empAId]);
      expect(resEmp.rows.length).toBe(0);

      const resHist = await client.query('SELECT * FROM employee_history WHERE id = $1', [histAId]);
      expect(resHist.rows.length).toBe(0);

      const resFile = await client.query('SELECT * FROM files WHERE id = $1', [fileAId]);
      expect(resFile.rows.length).toBe(0);
    }, db.appPool);

    // 4. Query as hrms_app WITH Company A tenant context -> RLS returns the records
    await withTenant({ companyId: companyAId, userId: empAId }, async (_tx, client) => {
      const resLoc = await client.query('SELECT * FROM work_locations WHERE id = $1', [locAId]);
      expect(resLoc.rows.length).toBe(1);

      const resEmp = await client.query('SELECT * FROM employees WHERE id = $1', [empAId]);
      expect(resEmp.rows.length).toBe(1);

      const resHist = await client.query('SELECT * FROM employee_history WHERE id = $1', [histAId]);
      expect(resHist.rows.length).toBe(1);

      const resFile = await client.query('SELECT * FROM files WHERE id = $1', [fileAId]);
      expect(resFile.rows.length).toBe(1);
    }, db.appPool);
  });

  it('enforces composite foreign keys blocking cross-tenant references', async () => {
    const deptBId = generateUuidV7();

    // 1. Create a department in Company B
    await withTenant({ companyId: companyBId, userId: generateUuidV7() }, async (_tx, client) => {
      await client.query(
        `INSERT INTO departments (id, company_id, name, code)
         VALUES ($1, $2, 'Beta Engineering', 'ENG-B')`,
        [deptBId, companyBId],
      );
    }, db.appPool);

    // 2. Attempt to create employee in Company A referencing Department in Company B
    // Must be rejected by composite foreign key (company_id, department_id)
    await expect(
      withTenant({ companyId: companyAId, userId: generateUuidV7() }, async (_tx, client) => {
        await client.query(
          `INSERT INTO employees (company_id, emp_code, first_name, last_name, email_work, doj, status, search_key, department_id)
           VALUES ($1, 'EMP-CROSS', 'Hacker', 'X', 'hack@alpha.corp', '2026-01-01', 'active', 'hacker x emp-cross', $2);`,
          [companyAId, deptBId],
        );
      }, db.appPool),
    ).rejects.toThrow(/violates foreign key constraint/i);
  });

  it('enforces depth cap of 25 on reporting_path', async () => {
    const twentySixAncestors = Array.from({ length: 26 }, () => generateUuidV7());

    await expect(
      withTenant({ companyId: companyAId, userId: generateUuidV7() }, async (_tx, client) => {
        await client.query(
          `INSERT INTO employees (company_id, emp_code, first_name, last_name, email_work, doj, status, search_key, reporting_path)
           VALUES ($1, 'EMP-DEEP', 'Deep', 'Tree', 'deep@alpha.corp', '2026-01-01', 'active', 'deep tree emp-deep', $2::uuid[]);`,
          [companyAId, twentySixAncestors],
        );
      }, db.appPool),
    ).rejects.toThrow(/chk_reporting_path_depth/i);
  });

  it('atomically increments sequence via next_counter_seq() within tenant context', async () => {
    await withTenant({ companyId: companyAId, userId: generateUuidV7() }, async (_tx, client) => {
      const seq1 = await client.query('SELECT next_counter_seq($1, $2) as seq', [companyAId, 'emp_code']);
      expect(Number(seq1.rows[0]?.seq)).toBe(1);

      const seq2 = await client.query('SELECT next_counter_seq($1, $2) as seq', [companyAId, 'emp_code']);
      expect(Number(seq2.rows[0]?.seq)).toBe(2);
    }, db.appPool);

    // Company B has its own independent counter sequence
    await withTenant({ companyId: companyBId, userId: generateUuidV7() }, async (_tx, client) => {
      const seqB = await client.query('SELECT next_counter_seq($1, $2) as seq', [companyBId, 'emp_code']);
      expect(Number(seqB.rows[0]?.seq)).toBe(1);
    }, db.appPool);
  });
});
