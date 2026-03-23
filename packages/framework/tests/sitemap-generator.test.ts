import { describe, it, expect } from 'vitest';
import {
  generateSitemap,
  generateSitemapFromUrls,
  generateSitemapIndex,
  type SsgRoute,
  type SitemapOptions
} from '../src/sitemap-generator';
import type { Cossack, PageOptions } from '@cossackframework/core';

describe('sitemap-generator', () => {
  // Mock Cossack class for testing
  class MockCossack {}

  describe('generateSitemap', () => {
    it('should generate a valid sitemap XML string', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/',
          filePath: '/src/pages/index/index.ts',
          component: MockCossack as any,
        },
        {
          routePath: '/about',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
        lastmod: new Date('2026-03-23'),
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(sitemap).toContain('<loc>https://example.com/</loc>');
      expect(sitemap).toContain('<loc>https://example.com/about</loc>');
      expect(sitemap).toContain('</urlset>');
    });

    it('should exclude API routes', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/api/users',
          filePath: '/src/pages/api/users/index.ts',
          component: MockCossack as any,
        },
        {
          routePath: '/about',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).not.toContain('/api/users');
      expect(sitemap).toContain('/about');
    });

    it('should exclude 404 pages', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/404',
          filePath: '/src/pages/404/index.ts',
          component: MockCossack as any,
        },
        {
          routePath: '/about',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).not.toContain('/404');
      expect(sitemap).toContain('/about');
    });

    it('should exclude error pages', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/error',
          filePath: '/src/pages/error/index.ts',
          component: MockCossack as any,
        },
        {
          routePath: '/about',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).not.toContain('/error');
      expect(sitemap).toContain('/about');
    });

    it('should set homepage priority to 1.0', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/',
          filePath: '/src/pages/index/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      // Note: JavaScript converts 1.0 to 1 in template literals
      expect(sitemap).toContain('<priority>1</priority>');
    });

    it('should use default priority for non-homepage routes', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/about',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
        defaultPriority: 0.7,
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).toContain('<priority>0.7</priority>');
    });

    it('should escape XML special characters in URLs', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/products/category&name',
          filePath: '/src/pages/products/[category]/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).toContain('&amp;');
    });

    it('should remove trailing slashes except for root', () => {
      const routes: SsgRoute[] = [
        {
          routePath: '/about/',
          filePath: '/src/pages/about/index.ts',
          component: MockCossack as any,
        },
      ];

      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemap(routes, options);

      expect(sitemap).toContain('https://example.com/about</loc>');
      expect(sitemap).not.toContain('https://example.com/about/</loc>');
    });
  });

  describe('generateSitemapFromUrls', () => {
    it('should generate sitemap from URL array', () => {
      const urls = ['/', '/about', '/contact'];
      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
        lastmod: new Date('2026-03-23'),
      };

      const sitemap = generateSitemapFromUrls(urls, options);

      expect(sitemap).toContain('<loc>https://example.com/</loc>');
      expect(sitemap).toContain('<loc>https://example.com/about</loc>');
      expect(sitemap).toContain('<loc>https://example.com/contact</loc>');
    });

    it('should exclude API routes from URL array', () => {
      const urls = ['/', '/api/users', '/about'];
      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemapFromUrls(urls, options);

      expect(sitemap).toContain('<loc>https://example.com/</loc>');
      expect(sitemap).not.toContain('/api/users');
      expect(sitemap).toContain('<loc>https://example.com/about</loc>');
    });

    it('should handle URLs without leading slash', () => {
      const urls = ['about', 'contact'];
      const options: SitemapOptions = {
        baseUrl: 'https://example.com',
      };

      const sitemap = generateSitemapFromUrls(urls, options);

      expect(sitemap).toContain('<loc>https://example.com/about</loc>');
      expect(sitemap).toContain('<loc>https://example.com/contact</loc>');
    });
  });

  describe('generateSitemapIndex', () => {
    it('should generate a valid sitemap index XML', () => {
      const sitemaps = [
        { loc: 'https://example.com/sitemap-pages.xml', lastmod: new Date('2026-03-23') },
        { loc: 'https://example.com/sitemap-products.xml', lastmod: new Date('2026-03-23') },
      ];

      const sitemap = generateSitemapIndex(sitemaps, { baseUrl: 'https://example.com' });

      expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(sitemap).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(sitemap).toContain('<loc>https://example.com/sitemap-pages.xml</loc>');
      expect(sitemap).toContain('<loc>https://example.com/sitemap-products.xml</loc>');
      expect(sitemap).toContain('</sitemapindex>');
    });
  });
});
