import pg from 'pg';
import crypto from 'node:crypto';
import { getOwnerPool } from './client.js';
import { generateUuidV7 } from './id.js';

export async function seedAttendanceLoadData(poolOverride?: pg.Pool): Promise<{
  daysCount: number;
  punchesCount: number;
  regularizationsCount: number;
  elapsedMs: number;
}> {
  const startTime = Date.now();
  const pool = poolOverride ?? getOwnerPool();
  const client = await pool.connect();

  try {
    console.info('[Attendance Load Seed] Starting attendance production-scale seed...');
    await client.query('BEGIN');

    // 1. Resolve company
    const compRes = await client.query<{ id: string }>('SELECT id FROM companies LIMIT 1');
    if (compRes.rows.length === 0 || !compRes.rows[0]) {
      throw new Error('No company found. Run basic seed first.');
    }
    const companyId = compRes.rows[0].id;
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

    // Admin user id for audit tracking
    const adminRes = await client.query<{ id: string }>('SELECT id FROM users WHERE company_id = $1 LIMIT 1', [companyId]);
    const adminUserId = adminRes.rows[0]?.id || generateUuidV7();

    // 2. Resolve default work location or create if not present
    const locRes = await client.query<{ id: string }>('SELECT id FROM work_locations WHERE company_id = $1 LIMIT 1', [companyId]);
    let locationId = locRes.rows[0]?.id;
    if (!locationId) {
      locationId = generateUuidV7();
      await client.query(
        `INSERT INTO work_locations (id, company_id, code, name, timezone, center, radius_meters, created_by, updated_by)
         VALUES ($1, $2, 'HQ', 'Headquarters', 'Asia/Kolkata', ST_SetSRID(ST_MakePoint(77.594562, 12.971598), 4326)::geography, 100, $3, $3)
         ON CONFLICT (company_id, code) WHERE deleted_at IS NULL DO NOTHING`,
        [locationId, companyId, adminUserId],
      );
    }

    // 3. Resolve or create Default Shifts
    const shiftRes = await client.query<{ id: string; code: string }>(
      'SELECT id, code FROM shifts WHERE company_id = $1',
      [companyId],
    );

    let generalShiftId = shiftRes.rows.find(s => s.code === 'GEN')?.id;

    if (!generalShiftId) {
      generalShiftId = generateUuidV7();
      await client.query(
        `INSERT INTO shifts (id, company_id, code, name, start_time, end_time, crosses_midnight, grace_minutes, break_minutes, work_hours, created_by, updated_by)
         VALUES ($1, $2, 'GEN', 'General Shift', '09:00:00', '18:00:00', false, 15, 60, 8.00, $3, $3)
         ON CONFLICT (company_id, code) DO NOTHING`,
        [generalShiftId, companyId, adminUserId],
      );
    }

    // 4. Resolve or create Biometric Device
    const bioDevId = generateUuidV7();
    const hmacKey = crypto.randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO biometric_devices (id, company_id, device_id, name, ip_cidr, hmac_secret, location_id, is_active, created_by, updated_by)
       VALUES ($1, $2, 'BIO-GATE-HQ-01', 'HQ Main Turnstile', '192.168.10.0/24', $3, $4, true, $5, $5)
       ON CONFLICT (company_id, device_id) DO NOTHING`,
      [bioDevId, companyId, hmacKey, locationId, adminUserId],
    );

    // 5. Fetch up to 5,000 employees
    const empRes = await client.query<{ id: string; emp_code: string }>(
      'SELECT id, emp_code FROM employees WHERE company_id = $1 ORDER BY emp_code ASC LIMIT 5000',
      [companyId],
    );

    const employees = empRes.rows;
    if (employees.length === 0) {
      throw new Error('No employees found. Run seed-load.ts first.');
    }
    console.info(`[Attendance Load Seed] Seeding attendance for ${employees.length} employees...`);

    // 6. Generate Dates (past 14 days)
    const today = new Date();
    const dates: string[] = [];
    for (let d = 14; d >= 1; d--) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      if (dt.getDay() !== 0) { // Skip Sundays
        dates.push(dt.toISOString().slice(0, 10));
      }
    }

    let totalDaysInserted = 0;
    let totalPunchesInserted = 0;
    let totalRegsInserted = 0;

    // Process employees in chunks of 100 to stay well under PostgreSQL 65,535 param limit
    const EMP_CHUNK = 100;
    for (let c = 0; c < employees.length; c += EMP_CHUNK) {
      const empChunk = employees.slice(c, c + EMP_CHUNK);
      const dayValues: string[] = [];
      const dayParams: unknown[] = [companyId, adminUserId];
      let dIdx = 3;

      for (const emp of empChunk) {
        for (const dateStr of dates) {
          const dayId = generateUuidV7();
          const empNum = parseInt(emp.emp_code.replace(/\D/g, ''), 10) || 1;
          const isWeekend = (empNum + dateStr.charCodeAt(9)) % 7 === 6;

          let status = 'present';
          let firstInTime: string | null = null;
          let lastOutTime: string | null = null;
          let workMinutes = 480;
          let lateInMinutes = 0;
          const earlyOutMinutes = 0;

          if (isWeekend) {
            status = 'weekly_off';
            workMinutes = 0;
          } else if (empNum % 23 === 0) {
            status = 'absent';
            workMinutes = 0;
          } else if (empNum % 17 === 0) {
            status = 'half_day';
            workMinutes = 240;
            firstInTime = `${dateStr}T09:12:00.000Z`;
            lastOutTime = `${dateStr}T13:15:00.000Z`;
          } else if (empNum % 29 === 0) {
            status = 'on_leave';
            workMinutes = 0;
          } else {
            const inMin = 8 * 60 + 55 + (empNum % 25);
            const inH = Math.floor(inMin / 60);
            const inM = inMin % 60;
            firstInTime = `${dateStr}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00.000Z`;

            const outMin = 18 * 60 + 5 + (empNum % 20);
            const outH = Math.floor(outMin / 60);
            const outM = outMin % 60;
            lastOutTime = `${dateStr}T${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00.000Z`;

            if (inMin > 9 * 60 + 15) {
              lateInMinutes = inMin - (9 * 60);
            }
          }

          const isReg = empNum % 41 === 0 && status === 'present';

          dayValues.push(`(
            $${dIdx++}, $1, $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++},
            $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++},
            $${dIdx++}, 0, $${dIdx++}, $${dIdx++}, false, 1, 'seed-hash', $2, $2
          )`);

          dayParams.push(
            dayId,
            emp.id,
            dateStr,
            generalShiftId,
            firstInTime,
            lastOutTime,
            firstInTime ? 2 : 0, // punch_count
            workMinutes,
            workMinutes, // effective_minutes
            lateInMinutes,
            earlyOutMinutes,
            status,
            isReg,
          );
        }
      }

      if (dayValues.length > 0) {
        const insertDaysSql = `
          INSERT INTO attendance_days (
            id, company_id, employee_id, work_date, shift_id,
            first_in, last_out, punch_count, total_work_minutes, effective_minutes,
            late_in_minutes, early_out_minutes, overtime_minutes, status, is_regularized,
            is_locked, rule_version, source_hash, created_by, updated_by
          )
          VALUES ${dayValues.join(',\n')}
          ON CONFLICT (company_id, employee_id, work_date) DO NOTHING
        `;
        await client.query(insertDaysSql, dayParams);
        totalDaysInserted += dayValues.length;
      }

      console.info(
        `[Attendance Load Seed] Processed batch: ${c + empChunk.length}/${employees.length} employees (${totalDaysInserted} attendance days)...`,
      );
    }

    // 7. Insert live sample punches for today and yesterday
    const punchValues: string[] = [];
    const punchParams: unknown[] = [companyId];
    let pIdx = 2;

    const punchSampleEmployees = employees.slice(0, 1000); // 1,000 employees with live punches
    const punchDate = dates[dates.length - 1] || today.toISOString().slice(0, 10);

    for (const emp of punchSampleEmployees) {
      const empNum = parseInt(emp.emp_code.replace(/\D/g, ''), 10) || 1;
      const inPunchId = generateUuidV7();
      const inTime = `${punchDate}T09:${String(empNum % 50).padStart(2, '0')}:14.000Z`;
      const isBiometric = empNum % 3 === 0;

      punchValues.push(`(
        $${pIdx++}, $1, $${pIdx++}, $${pIdx++}, 'in', $${pIdx++}, $${pIdx++},
        ST_SetSRID(ST_MakePoint(77.594562, 12.971598), 4326)::geography, 4.5, true, 15,
        'valid', 'PUNCH_SUCCESS', '{}', false, NOW()
      )`);

      punchParams.push(
        inPunchId,
        emp.id,
        inTime,
        isBiometric ? 'biometric' : 'mobile',
        punchDate,
      );

      // Out punch for some
      if (empNum % 2 === 0) {
        const outPunchId = generateUuidV7();
        const outTime = `${punchDate}T18:${String(empNum % 45).padStart(2, '0')}:22.000Z`;

        punchValues.push(`(
          $${pIdx++}, $1, $${pIdx++}, $${pIdx++}, 'out', $${pIdx++}, $${pIdx++},
          ST_SetSRID(ST_MakePoint(77.594562, 12.971598), 4326)::geography, 5.0, true, 18,
          'valid', 'PUNCH_SUCCESS', '{}', false, NOW()
        )`);

        punchParams.push(
          outPunchId,
          emp.id,
          outTime,
          isBiometric ? 'biometric' : 'mobile',
          punchDate,
        );
      }
    }

    if (punchValues.length > 0) {
      const insertPunchesSql = `
        INSERT INTO attendance_punches (
          id, company_id, employee_id, punch_time, punch_type, source, work_date,
          location_coords, gps_accuracy, is_inside_geofence, distance_meters,
          status, reason_code, flag_reasons, is_synthetic, created_at
        )
        VALUES ${punchValues.join(',\n')}
      `;
      await client.query(insertPunchesSql, punchParams);
      totalPunchesInserted = punchValues.length;
    }

    // 8. Seed sample Regularization Requests
    const regEmployees = employees.slice(50, 75);
    const regValues: string[] = [];
    const regParams: unknown[] = [companyId, adminUserId];
    let rIdx = 3;

    for (let i = 0; i < regEmployees.length; i++) {
      const emp = regEmployees[i]!;
      const regId = generateUuidV7();
      const status = i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'approved' : 'rejected';

      regValues.push(`(
        $${rIdx++}, $1, $${rIdx++}, $${rIdx++}, 'punch_missing',
        'Official client site meeting during morning shift',
        '09:00', '18:00', $${rIdx++}, $2, $2
      )`);

      regParams.push(
        regId,
        emp.id,
        punchDate,
        status,
      );
    }

    if (regValues.length > 0) {
      const insertRegSql = `
        INSERT INTO attendance_regularization_requests (
          id, company_id, employee_id, date, request_type, reason,
          in_time, out_time, status, created_by, updated_by
        )
        VALUES ${regValues.join(',\n')}
        ON CONFLICT (company_id, id) DO NOTHING
      `;
      await client.query(insertRegSql, regParams);
      totalRegsInserted = regValues.length;
    }

    await client.query('COMMIT');
    const elapsedMs = Date.now() - startTime;
    console.info(
      `[Attendance Load Seed] Complete! Inserted ${totalDaysInserted} attendance days, ${totalPunchesInserted} punches, ${totalRegsInserted} regularizations in ${elapsedMs}ms.`,
    );

    return {
      daysCount: totalDaysInserted,
      punchesCount: totalPunchesInserted,
      regularizationsCount: totalRegsInserted,
      elapsedMs,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Attendance Load Seed] Error during seed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution entrypoint
if (process.argv[1]?.includes('seed-attendance-load')) {
  seedAttendanceLoadData()
    .then(res => {
      console.info(`[Attendance Seed Success] Seeded in ${res.elapsedMs}ms`);
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
