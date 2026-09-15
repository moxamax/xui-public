import { getStaticClassText } from "./class-values.mjs";

const LAYOUT_TOKEN_REFERENCE =
  /var\(\s*(--layout-space-[a-z0-9-]+)\s*\)/giu;

export function createNoUnknownLayoutToken(layoutTokens) {
  const validTokens = [...layoutTokens].sort().join(", ");

  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        unknown:
          'Unknown layout token "{{token}}"; use one of {{validTokens}} from the installed design-system release.',
      },
    },
    create(context) {
      return {
        JSXAttribute(node) {
          for (const { node: classNode, text } of getStaticClassText(node)) {
            const invalidTokens = new Set();
            for (const match of text.matchAll(LAYOUT_TOKEN_REFERENCE)) {
              if (!layoutTokens.has(match[1])) {
                invalidTokens.add(match[1]);
              }
            }
            for (const token of invalidTokens) {
              context.report({
                node: classNode,
                messageId: "unknown",
                data: { token, validTokens },
              });
            }
          }
        },
      };
    },
  };
}
