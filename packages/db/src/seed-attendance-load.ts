import pg from 'pg';
import crypto from 'node:crypto';
import { getOwnerPool } from './client.js';
import { generateUuidV7 } from './id.js';

export async function seedAttendanceLoadData(poolOverride?: pg.Pool): Promise<{
  daysCount: number;
  punchesCount: number;
  exceptionsCount: number;
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

    // 2. Resolve or create Default Shifts
    const shiftRes = await client.query<{ id: string; code: string }>(
      'SELECT id, code FROM shifts WHERE company_id = $1',
      [companyId],
    );

    let generalShiftId = shiftRes.rows.find(s => s.code === 'GEN')?.id;
    let morningShiftId = shiftRes.rows.find(s => s.code === 'MRN')?.id;
    let nightShiftId = shiftRes.rows.find(s => s.code === 'NGT')?.id;

    if (!generalShiftId) {
      generalShiftId = generateUuidV7();
      await client.query(
        `INSERT INTO shifts (id, company_id, code, name, start_time, end_time, crosses_midnight, is_night_shift, break_duration_minutes)
         VALUES ($1, $2, 'GEN', 'General Shift', '09:00:00', '18:00:00', false, false, 60)`,
        [generalShiftId, companyId],
      );
    }

    if (!morningShiftId) {
      morningShiftId = generateUuidV7();
      await client.query(
        `INSERT INTO shifts (id, company_id, code, name, start_time, end_time, crosses_midnight, is_night_shift, break_duration_minutes)
         VALUES ($1, $2, 'MRN', 'Morning Shift', '06:00:00', '14:30:00', false, false, 30)`,
        [morningShiftId, companyId],
      );
    }

    if (!nightShiftId) {
      nightShiftId = generateUuidV7();
      await client.query(
        `INSERT INTO shifts (id, company_id, code, name, start_time, end_time, crosses_midnight, is_night_shift, break_duration_minutes)
         VALUES ($1, $2, 'NGT', 'Night Shift', '22:00:00', '06:30:00', true, true, 45)`,
        [nightShiftId, companyId],
      );
    }

    // 3. Resolve or create Biometric Devices
    const bioDevId = generateUuidV7();
    const hmacKey = crypto.randomBytes(32).toString('hex');
    await client.query(
      `INSERT INTO biometric_devices (id, company_id, device_identifier, name, location, ip_address, hmac_secret_enc, hmac_key_id, is_active)
       VALUES ($1, $2, 'BIO-GATE-HQ-01', 'HQ Main Turnstile', 'Bangalore HQ Gate 1', '192.168.10.50', $3, 'v1', true)
       ON CONFLICT (company_id, device_identifier) DO NOTHING`,
      [bioDevId, companyId, hmacKey],
    );

    // 4. Fetch up to 5,000 employees
    const empRes = await client.query<{ id: string; emp_code: string }>(
      'SELECT id, emp_code FROM employees WHERE company_id = $1 ORDER BY emp_code ASC LIMIT 5000',
      [companyId],
    );

    const employees = empRes.rows;
    if (employees.length === 0) {
      throw new Error('No employees found. Run seed-load.ts first.');
    }
    console.info(`[Attendance Load Seed] Seeding attendance for ${employees.length} employees...`);

    // 5. Generate Dates (e.g. past 14 days)
    const today = new Date();
    const dates: string[] = [];
    for (let d = 14; d >= 1; d--) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - d);
      // Skip Sundays
      if (dt.getDay() !== 0) {
        dates.push(dt.toISOString().slice(0, 10));
      }
    }

    let totalDaysInserted = 0;
    let totalPunchesInserted = 0;
    let totalExceptionsInserted = 0;
    let totalRegsInserted = 0;

    // Process employees in chunks of 500
    const EMP_CHUNK = 500;
    for (let c = 0; c < employees.length; c += EMP_CHUNK) {
      const empChunk = employees.slice(c, c + EMP_CHUNK);
      const dayValues: string[] = [];
      const dayParams: unknown[] = [companyId];
      let dIdx = 2;

      for (const emp of empChunk) {
        for (const dateStr of dates) {
          const dayId = generateUuidV7();
          const empNum = parseInt(emp.emp_code.replace(/\D/g, ''), 10) || 1;
          const isWeekend = (empNum + dateStr.charCodeAt(9)) % 7 === 6; // Saturdays for some

          let status = 'present';
          let firstInTime: string | null = null;
          let lastOutTime: string | null = null;
          let workMinutes = 480;

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
            // Normal present
            const inMin = 8 * 60 + 55 + (empNum % 25);
            const inH = Math.floor(inMin / 60);
            const inM = inMin % 60;
            firstInTime = `${dateStr}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00.000Z`;

            const outMin = 18 * 60 + 5 + (empNum % 20);
            const outH = Math.floor(outMin / 60);
            const outM = outMin % 60;
            lastOutTime = `${dateStr}T${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00.000Z`;
          }

          const isReg = empNum % 41 === 0 && status === 'present';

          dayValues.push(`(
            $${dIdx++}, $1, $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++},
            $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++}, $${dIdx++}
          )`);

          dayParams.push(
            dayId,
            emp.id,
            dateStr,
            generalShiftId,
            status,
            firstInTime,
            lastOutTime,
            workMinutes,
            60, // break minutes
            0,  // overtime minutes
            isReg,
          );
        }
      }

      if (dayValues.length > 0) {
        const insertDaysSql = `
          INSERT INTO attendance_days (
            id, company_id, employee_id, date, shift_id, status,
            first_in_at, last_out_at, total_work_minutes, total_break_minutes,
            overtime_minutes, is_regularized
          )
          VALUES ${dayValues.join(',\n')}
          ON CONFLICT (company_id, employee_id, date) DO NOTHING
        `;
        await client.query(insertDaysSql, dayParams);
        totalDaysInserted += dayValues.length;
      }

      console.info(
        `[Attendance Load Seed] Processed batch: ${c + empChunk.length}/${employees.length} employees (${totalDaysInserted} attendance days)...`,
      );
    }

    // 6. Insert sample realistic Punches for today and yesterday (to power Live Board & Recent punch audits)
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
        $${pIdx++}, $1, $${pIdx++}, 'in', $${pIdx++}, $${pIdx++},
        $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, false, null
      )`);

      punchParams.push(
        inPunchId,
        emp.id,
        inTime,
        isBiometric ? 'biometric' : 'mobile',
        12.971598,
        77.594562,
        4.5,
        15, // 15m from center
        true, // isInsideGeofence
      );

      // Out punch for some
      if (empNum % 2 === 0) {
        const outPunchId = generateUuidV7();
        const outTime = `${punchDate}T18:${String(empNum % 45).padStart(2, '0')}:22.000Z`;

        punchValues.push(`(
          $${pIdx++}, $1, $${pIdx++}, 'out', $${pIdx++}, $${pIdx++},
          $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, false, null
        )`);

        punchParams.push(
          outPunchId,
          emp.id,
          outTime,
          isBiometric ? 'biometric' : 'mobile',
          12.971598,
          77.594562,
          5.0,
          18,
          true,
        );
      }
    }

    if (punchValues.length > 0) {
      const insertPunchesSql = `
        INSERT INTO attendance_punches (
          id, company_id, employee_id, punch_type, punch_time, source,
          latitude, longitude, accuracy_meters, distance_meters, is_inside_geofence,
          is_synthetic, synthetic_reason
        )
        VALUES ${punchValues.join(',\n')}
        ON CONFLICT (company_id, id) DO NOTHING
      `;
      await client.query(insertPunchesSql, punchParams);
      totalPunchesInserted = punchValues.length;
    }

    // 7. Seed sample Exceptions
    const excDate = dates[dates.length - 2] || punchDate;
    const excEmployees = employees.slice(0, 50);
    const excValues: string[] = [];
    const excParams: unknown[] = [companyId];
    let eIdx = 2;

    for (let i = 0; i < excEmployees.length; i++) {
      const emp = excEmployees[i]!;
      const excId = generateUuidV7();
      const excType = i % 3 === 0 ? 'missing_out_punch' : i % 3 === 1 ? 'geofence_violation' : 'biometric_mismatch';
      const severity = i % 2 === 0 ? 'medium' : 'high';

      excValues.push(`(
        $${eIdx++}, $1, $${eIdx++}, $${eIdx++}, $${eIdx++}, $${eIdx++},
        'pending', $${eIdx++}
      )`);

      excParams.push(
        excId,
        emp.id,
        excDate,
        excType,
        severity,
        JSON.stringify({ notes: `Automated anomaly detected for ${excType}`, employeeCode: emp.emp_code }),
      );
    }

    if (excValues.length > 0) {
      const insertExcSql = `
        INSERT INTO attendance_exceptions (
          id, company_id, employee_id, date, exception_type, severity,
          resolution_status, details
        )
        VALUES ${excValues.join(',\n')}
        ON CONFLICT (company_id, id) DO NOTHING
      `;
      await client.query(insertExcSql, excParams);
      totalExceptionsInserted = excValues.length;
    }

    // 8. Seed sample Regularizations
    const regEmployees = employees.slice(50, 75);
    const regValues: string[] = [];
    const regParams: unknown[] = [companyId];
    let rIdx = 2;

    for (let i = 0; i < regEmployees.length; i++) {
      const emp = regEmployees[i]!;
      const regId = generateUuidV7();
      const status = i % 3 === 0 ? 'pending' : i % 3 === 1 ? 'approved' : 'rejected';

      regValues.push(`(
        $${rIdx++}, $1, $${rIdx++}, $${rIdx++}, 'missing_punch',
        'Official client site meeting during morning shift',
        $${rIdx++}, $${rIdx++}, $${rIdx++}
      )`);

      regParams.push(
        regId,
        emp.id,
        excDate,
        `${excDate}T09:00:00.000Z`,
        `${excDate}T18:00:00.000Z`,
        status,
      );
    }

    if (regValues.length > 0) {
      const insertRegSql = `
        INSERT INTO attendance_regularizations (
          id, company_id, employee_id, date, reason_category, reason,
          requested_in_time, requested_out_time, status
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
      `[Attendance Load Seed] Complete! Inserted ${totalDaysInserted} attendance days, ${totalPunchesInserted} punches, ${totalExceptionsInserted} exceptions, ${totalRegsInserted} regularizations in ${elapsedMs}ms.`,
    );

    return {
      daysCount: totalDaysInserted,
      punchesCount: totalPunchesInserted,
      exceptionsCount: totalExceptionsInserted,
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
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
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
