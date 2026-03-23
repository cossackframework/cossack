import { describe, it, expect } from 'vitest';
import { filePathToRoutePath } from '../src/ssg-renderer';

describe('ssg-renderer', () => {
  describe('filePathToRoutePath', () => {
    it('should convert page file paths to route paths', () => {
      expect(filePathToRoutePath('/src/pages/index/index.ts')).toBe('/');
      expect(filePathToRoutePath('/src/pages/about/index.ts')).toBe('/about');
      expect(filePathToRoutePath('/src/pages/contact/index.ts')).toBe('/contact');
    });

    it('should convert nested page file paths to route paths', () => {
      expect(filePathToRoutePath('/src/pages/blog/posts/index.ts')).toBe('/blog/posts');
      expect(filePathToRoutePath('/src/pages/docs/api/reference/index.ts')).toBe('/docs/api/reference');
    });

    it('should handle dynamic route segments', () => {
      expect(filePathToRoutePath('/src/pages/hello/[name]/index.ts')).toBe('/hello/[name]');
      expect(filePathToRoutePath('/src/pages/users/[id]/posts/[postId]/index.ts')).toBe('/users/[id]/posts/[postId]');
    });

    it('should handle MDX files', () => {
      expect(filePathToRoutePath('/src/pages/docs/index.mdx')).toBe('/docs');
      expect(filePathToRoutePath('/src/pages/blog/my-post/index.mdx')).toBe('/blog/my-post');
    });

    it('should handle root index correctly', () => {
      expect(filePathToRoutePath('/src/pages/index.ts')).toBe('/');
    });
  });
});
