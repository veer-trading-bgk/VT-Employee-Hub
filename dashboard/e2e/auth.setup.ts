import { test as setup } from '@playwright/test';
import { login } from './helpers/login';

const AUTH_FILE = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  await login(page);
  // Persist cookies + localStorage so all smoke tests skip the login step
  await page.context().storageState({ path: AUTH_FILE });
});
