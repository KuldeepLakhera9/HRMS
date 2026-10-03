import pg from 'pg';
import crypto from 'node:crypto';
import { getOwnerPool } from './client.js';
import { generateUuidV7 } from './id.js';

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
  'Shaurya', 'Atharv', 'Advik', 'Pranav', 'Advaith', 'Aaryav', 'Dhruv', 'Kabir', 'Rudra', 'Ananya',
  'Diya', 'Saanvi', 'Aadhya', 'Pari', 'Anika', 'Navya', 'Angel', 'Isha', 'Myra', 'Sara',
  'Aarohi', 'Siya', 'Riya', 'Kavya', 'Avani', 'Anushka', 'Tara', 'Sneha', 'Tanvi', 'Ira',
  'Pooja', 'Priya', 'Deepak', 'Rahul', 'Amit', 'Sunil', 'Neha', 'Rohan', 'Vikram', 'Meera',
];

const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Singh', 'Kumar', 'Mehta',
  'Joshi', 'Bhat', 'Deshmukh', 'Kulkarni', 'Chakraborty', 'Banerjee', 'Chatterjee', 'Das', 'Roy', 'Sen',
  'Pillai', 'Menon', 'Rao', 'Prasad', 'Kapoor', 'Malhotra', 'Khanna', 'Bose', 'Dutta', 'Mishra',
  'Pandey', 'Trivedi', 'Saxena', 'Choudhury', 'Bhattacharya', 'Agarwal', 'Bansal', 'Goyal', 'Singhal', 'Mittal',
];

const SHIRT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// 32-byte default master encryption key
const DEFAULT_KEY = Buffer.from(
  process.env.ENCRYPTION_MASTER_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'hex',
);
const BLIND_INDEX_SALT = 'blind-index-salt-hrms-production-grade';

function encryptField(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DEFAULT_KEY, iv);
  let enc = cipher.update(plaintext, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `v1:master:${iv.toString('hex')}:${tag}:${enc}`;
}

function computeBlindIndex(value: string, companyId: string): string {
  const hmac = crypto.createHmac('sha256', BLIND_INDEX_SALT);
  hmac.update(`${companyId}:${value.trim().toUpperCase()}`);
  return hmac.digest('hex');
}

export async function generate5000Employees(poolOverride?: pg.Pool): Promise<{ count: number; elapsedMs: number }> {
  const startTime = Date.now();
  const pool = poolOverride ?? getOwnerPool();
  const client = await pool.connect();

  try {
    console.info('[Load Generator] Initializing 5,000 employee high-volume seed...');
    await client.query('BEGIN');

    // 1. Get default company
    const compRes = await client.query<{ id: string }>('SELECT id FROM companies LIMIT 1');
    if (compRes.rows.length === 0 || !compRes.rows[0]) {
      throw new Error('No company found. Run basic seed first.');
    }
    const companyId = compRes.rows[0].id;
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

    // 2. Fetch org references
    const [deptRes, desRes, locRes, ccRes] = await Promise.all([
      client.query<{ id: string }>('SELECT id FROM departments WHERE company_id = $1', [companyId]),
      client.query<{ id: string }>('SELECT id FROM designations WHERE company_id = $1', [companyId]),
      client.query<{ id: string }>('SELECT id FROM locations WHERE company_id = $1', [companyId]),
      client.query<{ id: string }>('SELECT id FROM cost_centers WHERE company_id = $1', [companyId]),
    ]);

    const deptIds = deptRes.rows.map(r => r.id);
    const desIds = desRes.rows.map(r => r.id);
    const locIds = locRes.rows.map(r => r.id);
    const ccIds = ccRes.rows.map(r => r.id);

    console.info(`[Load Generator] Company ${companyId} resolved with ${deptIds.length} departments, ${desIds.length} designations.`);

    // 3. Generate 5,000 records in batches of 500
    const TOTAL = 5000;
    const CHUNK_SIZE = 500;
    let inserted = 0;

    for (let batchStart = 0; batchStart < TOTAL; batchStart += CHUNK_SIZE) {
      const batchCount = Math.min(CHUNK_SIZE, TOTAL - batchStart);
      const valueClauses: string[] = [];
      const params: unknown[] = [companyId];
      let pIdx = 2;

      for (let i = 0; i < batchCount; i++) {
        const empNum = batchStart + i + 1;
        const empCode = `EMP${String(empNum).padStart(5, '0')}`;
        const fName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]!;
        const lName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]!;
        const emailWork = `${fName.toLowerCase()}.${lName.toLowerCase()}.${empNum}@orghub.internal`;
        const emailPersonal = `${fName.toLowerCase()}${empNum}@example.com`;
        const phone = `+9198${String(10000000 + (empNum * 123) % 90000000)}`;
        const doj = `202${Math.floor(Math.random() * 4) + 1}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
        const dob = `199${Math.floor(Math.random() * 9)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;

        const status = empNum % 25 === 0 ? 'notice' : empNum % 15 === 0 ? 'probation' : 'active';
        const empType = empNum % 20 === 0 ? 'contract' : empNum % 30 === 0 ? 'intern' : 'full_time';

        const deptId = deptIds[empNum % (deptIds.length || 1)] || null;
        const desId = desIds[empNum % (desIds.length || 1)] || null;
        const locId = locIds[empNum % (locIds.length || 1)] || null;
        const ccId = ccIds[empNum % (ccIds.length || 1)] || null;

        const panRaw = `ABCDE${String(1000 + (empNum % 9000))}F`;
        const aadhaarRaw = `${String(100000000000 + (empNum * 98765) % 900000000000)}`;
        const bankRaw = `91${String(1000000000 + (empNum * 876) % 9000000000)}`;

        const panEnc = encryptField(panRaw);
        const panBlindIdx = computeBlindIndex(panRaw, companyId);
        const aadhaarEnc = encryptField(aadhaarRaw);
        const bankEnc = encryptField(bankRaw);

        const customFields = {
          shirt_size: SHIRT_SIZES[empNum % SHIRT_SIZES.length],
          blood_group: BLOOD_GROUPS[empNum % BLOOD_GROUPS.length],
          badge_number: `B-${10000 + empNum}`,
        };

        const searchKey = `${empCode} ${fName} ${lName} ${emailWork}`.toLowerCase();
        const id = generateUuidV7();

        const placeholders = [
          `$${pIdx++}`, // id
          '$1',          // company_id
          `$${pIdx++}`, // emp_code
          `$${pIdx++}`, // first_name
          `$${pIdx++}`, // last_name
          `$${pIdx++}`, // dob
          `$${pIdx++}`, // gender
          `$${pIdx++}`, // marital_status
          `$${pIdx++}`, // email_work
          `$${pIdx++}`, // email_personal
          `$${pIdx++}`, // phone
          `$${pIdx++}`, // department_id
          `$${pIdx++}`, // designation_id
          `$${pIdx++}`, // grade_id
          `$${pIdx++}`, // cost_center_id
          `$${pIdx++}`, // location_id
          `$${pIdx++}`, // employment_type
          `$${pIdx++}`, // doj
          `$${pIdx++}`, // status
          `$${pIdx++}`, // job_effective_from
          `$${pIdx++}`, // bank_enc
          `$${pIdx++}`, // pan_enc
          `$${pIdx++}`, // pan_blind_idx
          `$${pIdx++}`, // aadhaar_enc
          `$${pIdx++}`, // custom_fields
          `$${pIdx++}`, // search_key
        ];

        params.push(
          id,
          empCode,
          fName,
          lName,
          dob,
          empNum % 2 === 0 ? 'male' : 'female',
          empNum % 3 === 0 ? 'married' : 'single',
          emailWork,
          emailPersonal,
          phone,
          deptId,
          desId,
          null, // grade_id
          ccId,
          locId,
          empType,
          doj,
          status,
          doj,
          bankEnc,
          panEnc,
          panBlindIdx,
          aadhaarEnc,
          JSON.stringify(customFields),
          searchKey,
        );

        valueClauses.push(`(${placeholders.join(', ')})`);
      }

      const sql = `
        INSERT INTO employees (
          id, company_id, emp_code, first_name, last_name, dob, gender, marital_status,
          email_work, email_personal, phone, department_id, designation_id, grade_id,
          cost_center_id, location_id, employment_type, doj, status, job_effective_from,
          bank_enc, pan_enc, pan_blind_idx, aadhaar_enc, custom_fields, search_key
        )
        VALUES ${valueClauses.join(',\n')}
        ON CONFLICT (company_id, emp_code) DO NOTHING
      `;

      await client.query(sql, params);
      inserted += batchCount;

      console.info(`[Load Generator] Progress: ${inserted} / ${TOTAL} employees seeded (${Math.round((inserted / TOTAL) * 100)}%)`);
    }

    await client.query('COMMIT');
    const elapsedMs = Date.now() - startTime;
    console.info(`[Load Generator] Successfully loaded 5,000 employees in ${elapsedMs}ms (${Math.round(5000 / (elapsedMs / 1000))} rows/sec).`);

    return { count: 5000, elapsedMs };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Load Generator] Error seeding load:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution entrypoint
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  generate5000Employees()
    .then(res => {
      console.info(`[Seed Complete] ${res.count} records loaded in ${res.elapsedMs}ms`);
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
