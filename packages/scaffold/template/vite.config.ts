import { cossackApp } from 'cossack/vite';

// The Cossack preset: the framework's plugins, the runtime's and those of the features and
// packages this project uses. A release changes the preset, not this file.
export default cossackApp({
  // Options (docs/vite-plugins.md): `plugins` adds Vite plugins, `config` adds Vite
  // configuration, and `pages`, `ssg`, `cloudflare` and `node` add options to those plugins.
});
