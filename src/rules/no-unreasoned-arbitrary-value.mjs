import { getStaticClassText } from "./class-values.mjs";

const ARBITRARY_VALUE =
  /(?:^|:)(?<utility>!?-?[a-z][a-z0-9-]*-\[(?<value>.+)\])(?:\/[^\s]+)?$/iu;
const DESIGN_TOKEN_REFERENCE = /^var\(\s*--[a-z0-9-]+\s*\)$/iu;
const ADJACENT_REASON =
  /^\s*\/\/\s*@xui-arbitrary-value-allow:\s*(\S(?:.*\S)?)\s*$/u;

export const noUnreasonedArbitraryValue = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unreasoned:
        'Tailwind arbitrary value "{{value}}" requires a non-empty reason on the preceding line; use a canonical design-system token/utility or add "// @xui-arbitrary-value-allow: <reason>".',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (hasAdjacentReason(context.sourceCode, node)) return;

        for (const { node: classNode, text } of getStaticClassText(node)) {
          if (hasAdjacentReason(context.sourceCode, classNode)) continue;
          const arbitraryValues = new Set();
          for (const className of text.split(/\s+/u)) {
            const arbitraryValue = getLiteralArbitraryValue(className);

            if (arbitraryValue !== null) {
              arbitraryValues.add(arbitraryValue);
            }
          }
          for (const value of arbitraryValues) {
            context.report({
              node: classNode,
              messageId: "unreasoned",
              data: { value },
            });
          }
        }
      },
    };
  },
};

function getLiteralArbitraryValue(className) {
  const match = className.match(ARBITRARY_VALUE);
  const value = match?.groups?.value;

  if (value === undefined || DESIGN_TOKEN_REFERENCE.test(value)) {
    return null;
  }

  return match.groups.utility;
}

function hasAdjacentReason(sourceCode, node) {
  const precedingLine = sourceCode.lines[node.loc.start.line - 2];

  return precedingLine !== undefined && ADJACENT_REASON.test(precedingLine);
}
