import { test, expect } from '@playwright/test';

test.describe('Sprint 4.4 Payroll Lifecycle, Payslip Vault & Expenses E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Super Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Payslip Vault page renders distribution controls, table, and re-issue modal', async ({
    page,
  }) => {
    await page.goto('/payroll/payslips');
    await expect(page.locator('h1')).toContainText('Payslip Vault & Distribution');

    // Verify search and period filter inputs exist
    await expect(page.locator('input[placeholder*="Search employee"]')).toBeVisible();
    await expect(page.locator('input[placeholder*="Filter YYYY-MM"]')).toBeVisible();

    // Verify table headers exist
    await expect(page.locator('th:has-text("Employee")')).toBeVisible();
    await expect(page.locator('th:has-text("Period")')).toBeVisible();
    await expect(page.locator('th:has-text("Gross")')).toBeVisible();
    await expect(page.locator('th:has-text("Deductions")')).toBeVisible();
    await expect(page.locator('th:has-text("Net Pay")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();

    // Check Re-issue modal if any payslip exists or button is clickable
    const reissueButton = page.locator('button:has-text("Re-issue")').first();
    if (await reissueButton.isVisible()) {
      await reissueButton.click();
      await expect(page.locator('text=Re-issue Payslip PDF')).toBeVisible();
      await expect(page.locator('textarea[placeholder*="Audit Reason"]')).toBeVisible();
      await page.locator('button:has-text("Cancel")').click();
    }
  });

  test('Expense Claims page renders claims table, filter, and New Claim modal', async ({
    page,
  }) => {
    await page.goto('/expenses');
    await expect(page.locator('h1')).toContainText('Expense Claims & Reimbursements');

    // Verify filter dropdown and New Claim button
    await expect(page.locator('select')).toBeVisible();
    await expect(page.locator('button:has-text("New Claim")')).toBeVisible();

    // Open New Claim modal
    await page.locator('button:has-text("New Claim")').click();
    await expect(page.locator('text=Create Expense Claim')).toBeVisible();
    await expect(page.locator('input[placeholder*="Claim Title"]')).toBeVisible();

    // Fill form fields
    await page.fill('input[placeholder*="Claim Title"]', 'Conference Travel & Hotel');
    await page.locator('button:has-text("+ Add Item")').click();

    // Close modal
    await page.locator('button:has-text("Cancel")').click();
  });
});
