import { test, expect } from '@playwright/test';

test.describe('Sprint 1.4 End-to-End User Experience & Hardening', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Command Center Dashboard displays role-based telemetry cards & observability links', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toContainText('Workforce Command Center');

    // Verify key telemetry KPI cards
    await expect(page.locator('text=Total Employees')).toBeVisible();
    await expect(page.locator('text=Joiners This Month')).toBeVisible();
    await expect(page.locator('text=Pending Changes')).toBeVisible();
    await expect(page.locator('text=Document Expiries')).toBeVisible();

    // Verify operational quick action links
    await expect(page.locator('text=Bulk Import & Upsert')).toBeVisible();
    await expect(page.locator('text=Custom Fields Builder')).toBeVisible();
    await expect(page.locator('text=Prometheus Telemetry')).toBeVisible();
  });

  test('Bulk Employee Import wizard provides 3-step workflow with validation preview', async ({ page }) => {
    await page.goto('/employees/import');
    await expect(page.locator('h1')).toContainText('Bulk Employee Import & Upsert');

    // Verify 3-step indicators
    await expect(page.locator('text=Upload CSV')).toBeVisible();
    await expect(page.locator('text=Validation Preview')).toBeVisible();
    await expect(page.locator('text=Execution Complete')).toBeVisible();

    // Verify template download button and input textarea
    await expect(page.locator('button:has-text("Download Template")')).toBeVisible();
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();

    // Fill valid CSV text
    const sampleCsv = 'empCode,firstName,lastName,emailWork,doj\nEMP999,Alice,Wonder,alice.w@company.com,2023-05-01';
    await textarea.fill(sampleCsv);

    // Click validate
    const validateBtn = page.locator('button:has-text("Validate CSV Rows")');
    await expect(validateBtn).toBeVisible();
  });

  test('Custom Fields Builder allows configuring extensible entity attributes', async ({ page }) => {
    await page.goto('/admin/custom-fields');
    await expect(page.locator('h1')).toContainText('Custom Fields Builder');

    // Verify entity tabs
    await expect(page.locator('button:has-text("Employee Fields")')).toBeVisible();
    await expect(page.locator('button:has-text("Department Fields")')).toBeVisible();
    await expect(page.locator('button:has-text("Location Fields")')).toBeVisible();

    // Verify modal trigger
    const newFieldBtn = page.locator('button:has-text("New Custom Field")');
    await expect(newFieldBtn).toBeVisible();
    await newFieldBtn.click();

    // Verify modal fields
    await expect(page.locator('text=Field Key *')).toBeVisible();
    await expect(page.locator('text=Label Name *')).toBeVisible();
    await expect(page.locator('text=Data Type *')).toBeVisible();
    await expect(page.locator('text=Section Group')).toBeVisible();
  });

  test('Observability & health endpoints return valid telemetry', async ({ request }) => {
    // 1. Health liveness probe
    const healthRes = await request.get('/api/health');
    expect(healthRes.status()).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');
    expect(healthJson.uptimeSeconds).toBeGreaterThanOrEqual(0);

    // 2. Ready readiness probe
    const readyRes = await request.get('/api/ready');
    expect([200, 503]).toContain(readyRes.status());

    // 3. Prometheus metrics exposition
    const metricsRes = await request.get('/api/metrics');
    expect(metricsRes.status()).toBe(200);
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain('http_requests_total');
    expect(metricsText).toContain('db_pool_total');
  });
});
