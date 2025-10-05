#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const projectName = process.argv[2];
  if (!projectName) {
    console.error('Please provide a project name.');
    process.exit(1);
  }

  const projectDir = path.resolve(process.cwd(), projectName);
  const templateDir = path.resolve(__dirname, '../template');

  try {
    await fs.mkdir(projectDir, { recursive: true });
    await fs.cp(templateDir, projectDir, { recursive: true });
    console.log(`Cossack app created in ${projectDir}`);
  } catch (error) {
    console.error('Error creating Cossack app:', error);
    process.exit(1);
  }
}

main();
