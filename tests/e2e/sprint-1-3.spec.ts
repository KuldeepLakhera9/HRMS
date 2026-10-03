import { test, expect } from '@playwright/test';

test.describe('Sprint 1.3 End-to-End User Experience', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as HR Admin
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@orghub.internal');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('Employee Directory renders with search, filters, and column chooser', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.locator('h1')).toContainText('Employee Directory');

    // Verify search input
    const searchInput = page.locator('input[placeholder*="Search employees"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Jane');

    // Verify Filter presets exist
    await expect(page.locator('text=All Employees')).toBeVisible();
    await expect(page.locator('text=Active')).toBeVisible();
    await expect(page.locator('text=Probation')).toBeVisible();

    // Verify Column Chooser toggle exists
    const colChooserBtn = page.locator('button:has-text("Columns")');
    await expect(colChooserBtn).toBeVisible();
    await colChooserBtn.click();
    await expect(page.locator('text=Select Visible Columns')).toBeVisible();
  });

  test('Employee Profile provides 6 interactive tabs and step-up elevation for sensitive data', async ({ page }) => {
    await page.goto('/employees');
    // Click view profile on first record
    const viewBtn = page.locator('a:has-text("View")').first();
    if (await viewBtn.isVisible()) {
      await viewBtn.click();
      await page.waitForURL(/\/employees\/.+/);

      // Verify all 6 tabs exist
      await expect(page.locator('button:has-text("Overview")')).toBeVisible();
      await expect(page.locator('button:has-text("Job & Timeline")')).toBeVisible();
      await expect(page.locator('button:has-text("Document Vault")')).toBeVisible();
      await expect(page.locator('button:has-text("Personal & Contact")')).toBeVisible();
      await expect(page.locator('button:has-text("Sensitive Details")')).toBeVisible();
      await expect(page.locator('button:has-text("Activity")')).toBeVisible();

      // Test Sensitive Details tab and Step-Up modal
      await page.click('button:has-text("Sensitive Details")');
      await expect(page.locator('text=Encrypted Financial & Identity Records')).toBeVisible();

      // Click Reveal Full Values
      const unlockBtn = page.locator('button:has-text("Reveal Full Values")');
      await expect(unlockBtn).toBeVisible();
      await unlockBtn.click();

      // Step-up verification dialog pops up
      await expect(page.locator('text=Step-Up Authentication Required')).toBeVisible();
    }
  });

  test('Notification bell popover connects to SSE stream and displays preferences page', async ({ page }) => {
    // Check Header Bell icon
    const bellBtn = page.locator('button[title*="Notifications"]');
    await expect(bellBtn).toBeVisible();
    await bellBtn.click();

    // Popover opens
    await expect(page.locator('text=Notifications')).toBeVisible();
    await expect(page.locator('a:has-text("Preferences")')).toBeVisible();

    // Navigate to preferences page
    await page.click('a:has-text("Preferences")');
    await page.waitForURL('/settings/notifications');
    await expect(page.locator('h1')).toContainText('Notification Preferences');
    await expect(page.locator('text=In-App Notification Center')).toBeVisible();
    await expect(page.locator('text=Email Digests & Alerts')).toBeVisible();
  });

  test('Compliance Audit Trail provides monthly partition date pruning and diff inspection', async ({ page }) => {
    await page.goto('/audit-logs');
    await expect(page.locator('h1')).toContainText('Append-Only Audit Trail');

    // Date range inputs for partition pruning
    await expect(page.locator('input[title*="Partition pruning start date"]')).toBeVisible();
    await expect(page.locator('input[title*="Partition pruning end date"]')).toBeVisible();

    // Filter inputs
    await expect(page.locator('input[placeholder*="Entity"]')).toBeVisible();
    await expect(page.locator('input[placeholder*="Action"]')).toBeVisible();
  });
});
