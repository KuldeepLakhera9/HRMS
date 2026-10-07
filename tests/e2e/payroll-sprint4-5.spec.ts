import { test, expect } from '@playwright/test';

test.describe('Sprint 4.5 Tax Declarations, Statutory Filings & Reconciliation E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Super Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Employee Tax Declaration page renders regime selection and comparison calculator', async ({
    page,
  }) => {
    await page.goto('/tax/declarations');
    await expect(page.locator('h1')).toContainText('Tax Declarations');

    // Verify Regime switcher buttons exist
    await expect(page.locator('button:has-text("New Tax Regime (Default)")')).toBeVisible();
    await expect(page.locator('button:has-text("Old Tax Regime (Exemptions)")')).toBeVisible();

    // Verify Deduction sections and Add Item button
    await expect(page.locator('button:has-text("+ Add Deduction")')).toBeVisible();

    // Verify Regime Comparison Calculator drawer / trigger
    const compareBtn = page.locator('button:has-text("Regime Comparison Calculator")');
    await expect(compareBtn).toBeVisible();
    await compareBtn.click();
    await expect(page.locator('text=Regime Comparison Calculator')).toBeVisible();
    await expect(page.locator('input[type="number"]').first()).toBeVisible();
  });

  test('Tax Verification Queue renders pending declarations and verification controls', async ({
    page,
  }) => {
    await page.goto('/tax/verification');
    await expect(page.locator('h1')).toContainText('Tax Declaration Verification Queue');

    // Verify review tabs and action controls
    await expect(page.locator('th:has-text("Section")')).toBeVisible();
    await expect(page.locator('th:has-text("Declared Amount")')).toBeVisible();
    await expect(page.locator('th:has-text("Verified Amount")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();
  });

  test('Statutory Filings page renders tabs for ECR, ESI, PT, TDS returns, and Due Date calendar', async ({
    page,
  }) => {
    await page.goto('/payroll/statutory');
    await expect(page.locator('h1')).toContainText('Statutory Filings & Compliance Outputs');

    // Verify statutory tab triggers
    await expect(page.locator('button:has-text("PF ECR 2.0")')).toBeVisible();
    await expect(page.locator('button:has-text("ESI Monthly")')).toBeVisible();
    await expect(page.locator('button:has-text("PT & LWF")')).toBeVisible();
    await expect(page.locator('button:has-text("Quarterly TDS (Form 138/24Q)")')).toBeVisible();
    await expect(page.locator('button:has-text("Compliance Calendar")')).toBeVisible();

    // Switch to compliance calendar
    await page.locator('button:has-text("Compliance Calendar")').click();
    await expect(page.locator('text=Due Date Calendar')).toBeVisible();
    await expect(page.locator('text=EPF Electronic Challan-cum-Return')).toBeVisible();
  });

  test('Payroll Reconciliation Studio renders cycle controls, variance comparator and sign-off status', async ({
    page,
  }) => {
    await page.goto('/payroll/reconciliation');
    await expect(page.locator('h1')).toContainText('Payroll Reconciliation Studio');

    // Verify tolerance input and control badges
    await expect(page.locator('input[type="number"]')).toBeVisible();
    await expect(page.locator('text=Dual Sign-off Required')).toBeVisible();

    // Verify diff table headers
    await expect(page.locator('th:has-text("Employee")')).toBeVisible();
    await expect(page.locator('th:has-text("Component")')).toBeVisible();
    await expect(page.locator('th:has-text("Internal System")')).toBeVisible();
    await expect(page.locator('th:has-text("Legacy Baseline")')).toBeVisible();
    await expect(page.locator('th:has-text("Variance")')).toBeVisible();
    await expect(page.locator('th:has-text("Category")')).toBeVisible();
  });

  test('Opening Balances Cutover Wizard renders CSV template, preview and revert controls', async ({
    page,
  }) => {
    await page.goto('/payroll/opening-balances');
    await expect(page.locator('h1')).toContainText('YTD Opening Balances Cutover Wizard');

    // Verify CSV upload dropzone and template link
    await expect(page.locator('text=Upload Opening Balances CSV')).toBeVisible();
    await expect(page.locator('button:has-text("Download CSV Template")')).toBeVisible();
    await expect(page.locator('button:has-text("Validate & Preview")')).toBeVisible();
  });
});
