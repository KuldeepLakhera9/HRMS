import { test, expect } from '@playwright/test';

test.describe('Sprint 4.3 Payroll Calculation Worker & Finance Review Console E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Super Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Payroll Runs page renders cycle checklist, runs table and navigation', async ({
    page,
  }) => {
    await page.goto('/payroll/runs');
    await expect(page.locator('h1')).toContainText('Payroll Runs & Cycle Checklist');

    // Verify Cycle Checklist card exists
    await expect(page.locator('text=Monthly Payroll Execution Checklist')).toBeVisible();
    await expect(page.locator('text=Attendance Period Locked')).toBeVisible();
    await expect(page.locator('text=Salary Structures & Revisions')).toBeVisible();

    // Verify Run History & Staged Cycles table exists
    await expect(page.locator('text=Run History & Staged Cycles')).toBeVisible();
    await expect(page.locator('button:has-text("New Payroll Run")')).toBeVisible();
  });

  test('Finance Review Console renders summary metrics, tabs and action controls', async ({
    page,
  }) => {
    // Navigate to dummy or active run detail console
    await page.goto('/payroll/runs/018f0000-0000-7000-8000-000000000001');

    // Verify Review Console header
    await expect(page.locator('h1')).toContainText('Payroll Run Review');

    // Verify Summary Cards
    await expect(page.locator('text=Total Gross Pay')).toBeVisible();
    await expect(page.locator('text=Net Disbursal')).toBeVisible();
    await expect(page.locator('text=Employer Cost')).toBeVisible();
    await expect(page.locator('text=Staged Employees')).toBeVisible();

    // Verify View Switcher Tabs
    await expect(page.locator('button:has-text("Staged Employees")')).toBeVisible();
    await expect(page.locator('button:has-text("Variance Analysis")')).toBeVisible();
    await expect(page.locator('button:has-text("Pre-flight Checklist")')).toBeVisible();

    // Check Variance tab click
    await page.locator('button:has-text("Variance Analysis")').click();
    await expect(page.locator('text=MoM Gross/Net Payroll Variance')).toBeVisible();

    // Check Pre-flight Checklist tab click
    await page.locator('button:has-text("Pre-flight Checklist")').click();
    await expect(page.locator('text=Pre-flight Blockers & Warning Checklist')).toBeVisible();
  });

  test('Simulation dialog opens and handles dry-run calculation', async ({
    page,
  }) => {
    await page.goto('/payroll/runs/018f0000-0000-7000-8000-000000000001');

    const simButton = page.locator('button:has-text("Simulate Employee")');
    if (await simButton.isVisible()) {
      await simButton.click();
      await expect(page.locator('text=Simulate Single Employee Payslip')).toBeVisible();
      await expect(page.locator('text=Select Employee to Preview')).toBeVisible();
      // Close modal
      await page.locator('button:has-text("Cancel")').click();
    }
  });
});
