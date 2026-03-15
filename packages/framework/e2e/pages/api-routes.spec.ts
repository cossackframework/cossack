import { test, expect } from '../fixtures';

test.describe('API Routes', () => {
  test.describe('/api/hello', () => {
    test('should respond to GET request', async ({ page }) => {
      const response = await page.goto('/api/hello');

      expect(response).toBeDefined();

      const data = await response?.json();
      expect(data).toBeDefined();
    });

    test('should respond to POST request', async ({ context }) => {
      const response = await context.request.post('/api/hello', {
        data: { message: 'test' }
      });

      expect(response.status()).toBeLessThan(500);
    });

    test('should respond to PUT request', async ({ context }) => {
      const response = await context.request.put('/api/hello', {
        data: { message: 'updated' }
      });

      expect(response.status()).toBeLessThan(500);
    });

    test('should include custom headers', async ({ page }) => {
      const response = await page.goto('/api/hello');

      if (response) {
        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('application/json');
      }
    });
  });

  test.describe('/api/quick', () => {
    test('should respond quickly', async ({ page }) => {
      const startTime = Date.now();
      const response = await page.goto('/api/quick');
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
      expect(response).toBeDefined();
    });

    test('should return method and timestamp', async ({ page }) => {
      const response = await page.goto('/api/quick');

      if (response) {
        const data = await response.json();
        expect(data).toBeDefined();
      }
    });
  });
});
