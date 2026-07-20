import { loadStub } from './load-stub.js';


export function pageTemplate({ className, title, description, withHead }) {
  const headMethod = withHead
    ? `\n  head() {\n    return {\n      title: ${JSON.stringify(title)},\n      description: ${JSON.stringify(description)},\n    };\n  }\n`
    : '';
  const body = withHead
    ? `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>${
        description ? `\n        <p class="mt-2 text-gray-600">${description}</p>` : ''
      }\n      </div>`
    : `<div class="p-8">\n        <h1 class="text-2xl font-bold">${title}</h1>\n      </div>`;
  return loadStub('page.ts.stub', { className, headMethod, body });
}

export function pageMdxTemplate({ title, description }) {
  // MDX frontmatter is too simple to warrant a .stub file — inline is clearer.
  const frontmatter = description
    ? `---\ntitle: ${title}\ndescription: ${description}\n---`
    : `---\ntitle: ${title}\n---`;
  return `${frontmatter}\n\n# ${title}\n\nEdit this page at \`src/pages/<name>/index.mdx\`.\n`;
}

export function componentTemplate({ className, propsName }) {
  return loadStub('component.ts.stub', { className, propsName });
}

export function layoutTemplate({ className, kebab }) {
  return loadStub('layout.ts.stub', { className, kebab });
}

export function middlewareTemplate({ exportName }) {
  return loadStub('middleware.ts.stub', { exportName });
}

export function serviceTemplate({ className }) {
  return loadStub('service.ts.stub', { className });
}


