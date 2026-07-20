/** Stable public template catalog. */
export * from './templates/load-stub.js';
export * from './templates/core.js';
export {
  authLayoutTemplate, loginPageTemplate, registerPageTemplate,
  forgotPasswordPageTemplate, resetPasswordPageTemplate, authMiddlewareTemplate,
  rootLayoutWithAuthTemplate, configAuthTemplate, publicLayoutTemplate,
  publicIndexTemplate, dashboardLayoutTemplate, dashboardIndexTemplate,
  chatComponentTemplate, blogIndexTemplate, blogLayoutTemplate, blogHelloWorldTemplate, contactPageTemplate,
  dashboardProfileTemplate, dashboardSessionsTemplate, logoSvgTemplate,
  uuidHelperTemplate, permissionsConfigTemplate, roleModelTemplate,
  userRoleModelTemplate, rbacServiceTemplate, usersServiceTemplate,
  rolesServiceTemplate, usersIndexTemplate, usersNewTemplate, usersEditTemplate,
  rolesIndexTemplate, rolesNewTemplate, rolesEditTemplate,
  userRolesMigrationTemplate, defaultSeederTemplate, sessionModelTemplate,
  authModuleTemplate,
} from './templates/auth.js';
export * from './templates/database.js';
export * from './templates/language.js';
export * from './templates/ui.js';
