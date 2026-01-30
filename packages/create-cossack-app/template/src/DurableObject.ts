import { CossackDurableObject, Cossack } from '@cossackframework/core';
import { IndexPage } from './pages';

export class AppDurableObject extends CossackDurableObject {
  async getComponentRegistry(): Promise<Map<string, new () => Cossack>> {
    const registry = new Map<string, new () => Cossack>();
    // Map component classes by their file path
    // Adjust these paths to match your actual page structure
    registry.set('/src/pages/index.ts', IndexPage);
    // Add more pages here as needed:
    // registry.set('/src/pages/about/index.ts', AboutPage);
    return registry;
  }
}