import { getStaticClassText } from "./class-values.mjs";

export function createNoShadcnAlias(shadcnAliases) {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        alias:
          'Shadcn compatibility alias "{{alias}}" is blocked; use the corresponding canonical design-system utility from the installed release instead (for example, replace "bg-popover" with "bg-surface-raised").',
      },
    },
    create(context) {
      return {
        JSXAttribute(node) {
          for (const { node: classNode, text } of getStaticClassText(node)) {
            const invalidAliases = new Set();
            for (const className of text.split(/\s+/u)) {
              const utility = getBaseUtility(className);

              if (shadcnAliases.has(utility)) {
                invalidAliases.add(utility);
              }
            }
            for (const alias of invalidAliases) {
              context.report({
                node: classNode,
                messageId: "alias",
                data: { alias },
              });
            }
          }
        },
      };
    },
  };
}

function getBaseUtility(className) {
  return className
    .split(":")
    .at(-1)
    ?.replace(/^!/u, "")
    .replace(/\/.*$/u, "");
}
