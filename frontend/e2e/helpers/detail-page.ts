import { Page, expect } from '@playwright/test'

/**
 * Reusable assertions for detail pages with metadata, audit log, and unsaved changes guard.
 */

export async function expectMetadataVisible(page: Page) {
  await expect(page.getByText('Metadata')).toBeVisible({ timeout: 5000 })
}

export async function expectActivityLogVisible(page: Page) {
  await expect(page.getByText('Activity Log')).toBeVisible({ timeout: 5000 })
}

export async function expectSaveButtonOnChange(page: Page) {
  // Make a change to the first input
  const input = page.locator('input').first()
  const original = await input.inputValue()
  await input.fill(original + '-test')
  await page.waitForTimeout(300)

  const saveBtn = page.getByRole('button', { name: /Save/i })
  await expect(saveBtn).toBeVisible({ timeout: 5000 })

  // Revert
  await input.fill(original)
}

export async function expectDeleteFromForm(page: Page, listUrl: string) {
  const deleteBtn = page.getByRole('button', { name: /Delete/i })
  if (await deleteBtn.isVisible()) {
    await deleteBtn.click()
    const dialog = page.locator('[role="alertdialog"]')
    await expect(dialog).toBeVisible({ timeout: 3000 })
    await dialog.getByRole('button', { name: /Delete/i }).click()
    await page.waitForTimeout(2000)
    expect(page.url()).toContain(listUrl)
  }
}

/**
 * Navigate to the first item's detail page from a list view.
 * Returns the href or null if no items exist.
 */
export async function navigateToFirstItem(page: Page): Promise<string | null> {
  const firstLink = page.locator('tbody a').first()
  if (!(await firstLink.isVisible({ timeout: 5000 }).catch(() => false))) {
    return null
  }
  const href = await firstLink.getAttribute('href')
  if (href) {
    await page.goto(href)
    await page.waitForLoadState('networkidle')
  }
  return href
}
