import { getClassValues, isClassFragment } from "./class-values.mjs";

export const noDynamicTailwindClass = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      unresolvable:
        "Tailwind class cannot be resolved statically; use complete class names instead of interpolating a class fragment.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        for (const value of getClassValues(node)) {
          if (value.type !== "TemplateLiteral") continue;
          value.expressions.forEach((expression, index) => {
            if (isClassFragment(value, index)) {
              context.report({ node: expression, messageId: "unresolvable" });
            }
          });
        }
      },
    };
  },
};
