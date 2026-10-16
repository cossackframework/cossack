// Public entry for the template tree: elements, component tags, attributes and
// binding roles of an `html` or `svg` template, read the way the renderer reads it.
export { parseTemplate, VOID_ELEMENTS } from './template-parse';
export type {
  ParsedTemplate, TemplateAttribute, TemplateBindingNode, TemplateBindingRole, TemplateComment, TemplateComponent,
  TemplateElement, TemplateLocation, TemplateNamespace, TemplateNode, TemplateProblem, TemplateProblemCode, TemplateRange, TemplateText,
} from './template-parse';
