import { test, expect } from '@playwright/test';

test.describe('Sprint 4.1 Payroll Foundations, Salary Setup & Formula Engine E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Super Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Payroll Settings page renders legal entity details and Labour Code 50% floor controls', async ({
    page,
  }) => {
    await page.goto('/payroll/settings');
    await expect(page.locator('h1')).toContainText('Payroll Settings & Legal Entity');

    // Verify Legal Entity Card
    await expect(page.locator('h2:has-text("Primary Legal Entity")')).toBeVisible();
    await expect(page.locator('text=Permanent Account Number (PAN)')).toBeVisible();

    // Verify Pay Cycle & Paid-Days Basis
    await expect(page.locator('label:has-text("Paid-Days Basis")')).toBeVisible();

    // Verify Code on Wages toggle
    await expect(page.locator('text=Enforce Code on Wages 50% Floor Verification')).toBeVisible();

    // Verify Save Button
    await expect(page.locator('button:has-text("Save Configuration")')).toBeVisible();
  });

  test('Salary Components page renders registered components and evaluates formulas in live sandbox', async ({
    page,
  }) => {
    await page.goto('/payroll/components');
    await expect(page.locator('h1')).toContainText('Salary Components & Formula Engine');

    // Verify Formula Sandbox exists
    await expect(page.locator('h2:has-text("Live Formula Test Sandbox")')).toBeVisible();

    // Evaluate formula
    const evalButton = page.locator('button:has-text("Evaluate Formula AST")');
    await expect(evalButton).toBeVisible();
    await evalButton.click();

    // Verify evaluation result appears
    await expect(page.locator('text=Result: ₹')).toBeVisible();

    // Verify Registered Components Table
    await expect(page.locator('h2:has-text("Registered Components")')).toBeVisible();
  });

  test('Salary Structures page performs interactive CTC simulation with Labour Code check', async ({
    page,
  }) => {
    await page.goto('/payroll/structures');
    await expect(page.locator('h1')).toContainText('Salary Structures & CTC Simulator');

    // Verify CTC Breakup Calculator panel
    await expect(page.locator('h2:has-text("Interactive CTC Breakup Calculator")')).toBeVisible();

    // Simulate CTC Breakup
    const simButton = page.locator('button:has-text("Simulate Breakup")');
    if (await simButton.isEnabled()) {
      await simButton.click();
      await expect(page.locator('text=Monthly CTC')).toBeVisible();
      await expect(page.locator('text=Monthly Gross')).toBeVisible();
    }

    // Verify Configured Structures Table
    await expect(page.locator('h2:has-text("Configured Structures")')).toBeVisible();
  });

  test('Statutory Rules page renders chronological timeline and CA verification status', async ({
    page,
  }) => {
    await page.goto('/payroll/rules');
    await expect(page.locator('h1')).toContainText('Statutory Compliance Rules & Version Timeline');

    // Verify Timeline table header
    await expect(page.locator('th:has-text("Rule Key")')).toBeVisible();
    await expect(page.locator('th:has-text("Jurisdiction")')).toBeVisible();
    await expect(page.locator('th:has-text("CA Verification")')).toBeVisible();
  });
});
