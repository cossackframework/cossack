import { Plugin } from 'vite';
import MagicString from 'magic-string';
import ts from 'typescript';
import * as htmlparser2 from 'htmlparser2';

const componentRegistry = new Map<string, ComponentDef>();

interface ComponentDef {
    className: string;
    tag: string;
    templateBody: string; 
    props: string[];
}

export function cossackCompiler(): Plugin {
  return {
    name: 'cossack-compiler',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return;
      if (!code.includes('@Component')) return;

      const s = new MagicString(code);
      const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);

      ts.forEachChild(sourceFile, (node) => {
          if (ts.isClassDeclaration(node)) {
              const componentInfo = extractComponentInfo(node, sourceFile);
              if (componentInfo) {
                  componentRegistry.set(componentInfo.tag, componentInfo);
                  componentRegistry.set(`c:${componentInfo.tag}`, componentInfo);
              }
          }
      });

      function visit(node: ts.Node) {
          // Post-order traversal: Visit children first
          ts.forEachChild(node, visit);

          if (ts.isTaggedTemplateExpression(node)) {
             if (ts.isIdentifier(node.tag) && node.tag.text === 'html') {
                 processTemplate(node, sourceFile, s, id);
             }
          }
      }

      visit(sourceFile);

      return {
        code: s.toString(),
        map: s.generateMap({ source: id, includeContent: true }),
      };
    },
  };
}

interface Chunk {
    text: string;
    sourceStart: number;
    sourceEnd: number;
    isExpr: boolean;
    exprOriginal?: string;
}

function processTemplate(node: ts.TaggedTemplateExpression, sourceFile: ts.SourceFile, s: MagicString, id: string) {
    const template = node.template;
    const chunks: Chunk[] = [];

    // Build Chunks
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
        chunks.push({
            text: template.getText(sourceFile).slice(1, -1),
            sourceStart: template.getStart(sourceFile) + 1,
            sourceEnd: template.getEnd() - 1,
            isExpr: false
        });
    } else {
        const head = template.head;
        chunks.push({
            text: head.getText(sourceFile).slice(1, -2),
            sourceStart: head.getStart(sourceFile) + 1,
            sourceEnd: head.getEnd() - 2,
            isExpr: false
        });

        template.templateSpans.forEach((span, index) => {
            // Expression
            const exprStart = span.expression.getStart(sourceFile);
            const exprEnd = span.expression.getEnd();
            const exprText = span.expression.getText(sourceFile);
            const placeholder = `__C_${index}__`;
            
            chunks.push({
                text: placeholder,
                sourceStart: exprStart,
                sourceEnd: exprEnd,
                isExpr: true,
                exprOriginal: exprText
            });

            // Literal
            const literal = span.literal;
            const litText = literal.getText(sourceFile);
            let litContent = '';
            let litStart = literal.getStart(sourceFile);
            let litEnd = literal.getEnd();

            if (ts.isTemplateTail(literal)) {
                // }...`  => skip 1 start, 1 end
                litContent = litText.slice(1, -1);
                litStart += 1;
                litEnd -= 1;
            } else {
                // }...${ => skip 1 start, 2 end
                litContent = litText.slice(1, -2);
                litStart += 1;
                litEnd -= 2;
            }

            chunks.push({
                text: litContent,
                sourceStart: litStart,
                sourceEnd: litEnd,
                isExpr: false
            });
        });
    }

    const fullSynthetic = chunks.map(c => c.text).join('');

    if (fullSynthetic.includes('<c:')) {
        console.log(`[Compiler] optimizing template in ${id.split('/').pop()}`);
        
        const replacements = findReplacements(fullSynthetic);
        
        // Map replacements back to source coordinates
        // We need to iterate chunks to find where 'start' and 'end' land
        
        for (const rep of replacements) {
            const range = mapRange(rep.start, rep.end, chunks);
            
            // Restore expressions in content
            let content = rep.content.replace(/__C_(\d+)__/g, (_, idx) => {
                const chunkIndex = chunks.findIndex(c => c.isExpr && c.text === `__C_${idx}__`);
                if (chunkIndex !== -1 && chunks[chunkIndex].exprOriginal) {
                    return chunks[chunkIndex].exprOriginal!;
                }
                return '';
            });

            // IMPORTANT: If we are replacing prop=${expr}, content now has prop=(expr).
            // We need to ensure valid JS syntax if we stripped quotes. 
            // Our prop substitution logic (below) handled this by just putting the value in.
            
            s.overwrite(range.sourceStart, range.sourceEnd, content);
        }
    }
}

function mapRange(synStart: number, synEnd: number, chunks: Chunk[]): { sourceStart: number, sourceEnd: number } {
    let currentSyn = 0;
    let startMapped = -1;
    let endMapped = -1;

    for (const chunk of chunks) {
        const chunkLen = chunk.text.length;
        const chunkEndSyn = currentSyn + chunkLen;

        // Map Start
        if (startMapped === -1) {
            if (synStart >= currentSyn && synStart < chunkEndSyn) {
                const offset = synStart - currentSyn;
                startMapped = chunk.sourceStart + offset;
            } else if (synStart === chunkEndSyn) {
                 // Boundary case, usually start of next chunk
                 // We'll catch it next iteration or after loop
            }
        }

        // Map End
        if (endMapped === -1) {
            if (synEnd > currentSyn && synEnd <= chunkEndSyn) {
                const offset = synEnd - currentSyn;
                endMapped = chunk.sourceStart + offset;
            }
        }

        currentSyn += chunkLen;
    }
    
    // Boundary edge case handling
    if (startMapped === -1 && synStart === currentSyn) {
         // Appending at the very end? Unlikely for tag replacement
         startMapped = chunks[chunks.length-1].sourceEnd;
    }
    if (endMapped === -1 && synEnd === currentSyn) {
         endMapped = chunks[chunks.length-1].sourceEnd;
    }

    return { sourceStart: startMapped, sourceEnd: endMapped };
}

function findReplacements(html: string) {
    const replacements: { start: number; end: number; content: string }[] = [];
    const stack: { name: string; start: number; attribs: Record<string, string> }[] = [];
    
    const p = new htmlparser2.Parser({
        onopentag(name, attribs) {
            if (componentRegistry.has(name) && name.startsWith('c:')) {
                stack.push({ name, start: p.startIndex, attribs });
            }
        },
        onclosetag(name) {
            if (stack.length > 0 && stack[stack.length - 1].name === name) {
                const open = stack.pop()!;
                const def = componentRegistry.get(name)!;
                
                let body = def.templateBody;
                if (def.props && def.props.length > 0) {
                    for (const propName of def.props) {
                        const attrKey = `.${propName}`;
                        if (open.attribs[attrKey]) {
                            let val = open.attribs[attrKey];
                            const propRegex = new RegExp(`\\bthis\\.${propName}\\b`, 'g');
                            body = body.replace(propRegex, val);
                        }
                    }
                }

                replacements.push({
                    start: open.start,
                    end: p.endIndex + 1,
                    content: `<!-- ${name} flattened -->${body}<!-- /${name} -->`
                });
            }
        }
    }, { xmlMode: true, lowerCaseTags: false });

    p.write(html);
    p.end();
    
    return replacements;
}

// ... extractComponentInfo ...
function extractComponentInfo(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): ComponentDef | null {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    if (!decorators) return null;

    let tag = '';
    for (const dec of decorators) {
        if (ts.isCallExpression(dec.expression) && 
            ts.isIdentifier(dec.expression.expression) && 
            dec.expression.expression.text === 'Component') {
            const arg = dec.expression.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg)) {
                const tagProp = arg.properties.find(p => p.name && (p.name as any).text === 'tag');
                if (tagProp && ts.isPropertyAssignment(tagProp) && ts.isStringLiteral(tagProp.initializer)) {
                    tag = tagProp.initializer.text;
                }
            }
        }
    }
    if (!tag) return null;

    const props: string[] = [];
    node.members.forEach(member => {
        if (ts.isPropertyDeclaration(member)) {
            const memberDecs = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
            if (memberDecs) {
                 const isProp = memberDecs.some(d => 
                    ts.isCallExpression(d.expression) && 
                    ts.isIdentifier(d.expression.expression) && 
                    d.expression.expression.text === 'Prop'
                );
                if (isProp && ts.isIdentifier(member.name)) {
                    props.push(member.name.text);
                }
            }
        }
    });

    let templateBody = '';
    const renderMethod = node.members.find(m => 
        ts.isMethodDeclaration(m) && 
        ts.isIdentifier(m.name) && 
        m.name.text === 'render'
    ) as ts.MethodDeclaration;

    if (renderMethod && renderMethod.body) {
        const returnStmt = renderMethod.body.statements.find(s => ts.isReturnStatement(s)) as ts.ReturnStatement;
        if (returnStmt && returnStmt.expression && ts.isTaggedTemplateExpression(returnStmt.expression)) {
            const tag = returnStmt.expression.tag;
            if (ts.isIdentifier(tag) && tag.text === 'html') {
                const templateLit = returnStmt.expression.template;
                const rawText = templateLit.getText(sourceFile);
                if (rawText.startsWith('`') && rawText.endsWith('`')) {
                    templateBody = rawText.slice(1, -1);
                }
            }
        }
    }

    const def = {
        className: node.name?.text || 'Anonymous',
        tag,
        templateBody,
        props
    };
    
    console.log(`[Compiler] Extracted ${tag}: props=[${props.join(', ')}]`);
    return def;
}
