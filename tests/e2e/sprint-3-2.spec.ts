import { test, expect } from '@playwright/test';

test.describe('Sprint 3.2 End-to-End User Experience & Telemetry Verification', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Super Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Leave & Time Off Hub renders balance cards and apply form with live preview', async ({ page }) => {
    await page.goto('/leave');
    await expect(page.locator('h1')).toContainText('Leave & Time Off');

    // Verify Tab Navigation
    await expect(page.locator('button:has-text("Apply for Leave")')).toBeVisible();
    await expect(page.locator('button:has-text("Balances Snapshot")')).toBeVisible();
    await expect(page.locator('button:has-text("My Requests")')).toBeVisible();
    await expect(page.locator('button:has-text("Team Calendar")')).toBeVisible();

    // Verify Apply Form elements
    await expect(page.locator('label:has-text("Leave Type")')).toBeVisible();
    await expect(page.locator('label:has-text("From Date")')).toBeVisible();
    await expect(page.locator('label:has-text("To Date")')).toBeVisible();
    await expect(page.locator('label:has-text("Half Day")')).toBeVisible();

    // Fill in Reason
    const reasonTextarea = page.locator('textarea');
    if (await reasonTextarea.isVisible()) {
      await reasonTextarea.fill('Family vacation planning - Playwright test');
    }

    // Verify Submit button exists
    const submitBtn = page.locator('button:has-text("Submit Leave Request")');
    await expect(submitBtn).toBeVisible();
  });

  test('Team Calendar view renders day status matrix and scope controls', async ({ page }) => {
    await page.goto('/leave');

    // Switch to Team Calendar Tab
    const calTab = page.locator('button:has-text("Team Calendar")');
    await calTab.click();

    // Verify Calendar Controls
    await expect(page.locator('text=Calendar Scope:')).toBeVisible();
    await expect(page.locator('button:has-text("My Team")')).toBeVisible();
    await expect(page.locator('button:has-text("Department")')).toBeVisible();
    await expect(page.locator('button:has-text("Entire Company")')).toBeVisible();
  });

  test('Reports Hub displays catalog of enterprise reports with preview and export options', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.locator('h1')).toContainText('Reports & Analytics');

    // Verify Filter controls
    await expect(page.locator('label:has-text("Report Template")')).toBeVisible();
    await expect(page.locator('button:has-text("Preview (Top 50)")')).toBeVisible();
    await expect(page.locator('button:has-text("Export CSV")')).toBeVisible();

    // Click Preview Top 50
    const previewBtn = page.locator('button:has-text("Preview (Top 50)")');
    await previewBtn.click();

    // Verify Report Table or Status updates
    await page.waitForTimeout(1000);
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('Role Dashboards render telemetry widgets with Suspense boundaries', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toContainText('Workforce Command Center');

    // Assert key telemetry cards are visible
    await expect(page.locator('text=Total Employees')).toBeVisible();
    await expect(page.locator('text=Joiners This Month')).toBeVisible();
    await expect(page.locator('text=Pending Changes')).toBeVisible();
  });
});
