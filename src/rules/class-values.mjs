// Read possible class values, not conditions or arbitrary function arguments.
export function* getClassValues(attribute) {
  if (
    attribute.name.type !== "JSXIdentifier" ||
    attribute.name.name !== "className"
  ) {
    return;
  }

  const value = attribute.value;
  yield* readValue(value?.type === "JSXExpressionContainer" ? value.expression : value);
}

function* readValue(node, classList = false) {
  if (!node) return;

  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") yield node;
      break;
    case "TemplateLiteral":
      yield node;
      for (const [index, expression] of node.expressions.entries()) {
        if (!isClassFragment(node, index)) yield* readValue(expression);
      }
      break;
    case "ConditionalExpression":
      yield* readValue(node.consequent, classList);
      yield* readValue(node.alternate, classList);
      break;
    case "LogicalExpression":
      if (node.operator !== "&&") yield* readValue(node.left, classList);
      yield* readValue(node.right, classList);
      break;
    case "CallExpression":
      if (node.callee.type === "Identifier" && ["cn", "clsx"].includes(node.callee.name)) {
        for (const argument of node.arguments) yield* readValue(argument, true);
      }
      break;
    case "ArrayExpression":
      if (classList) {
        for (const element of node.elements) yield* readValue(element, true);
      }
      break;
    case "ObjectExpression":
      if (classList) {
        for (const property of node.properties) {
          if (property.type !== "Property" || property.kind !== "init" || property.method) continue;
          if (property.value.type === "Literal" && !property.value.value) continue;
          // Only keys become classes; values merely decide whether to include them.
          yield* readValue(property.key);
        }
      }
      break;
  }
}

export function isClassFragment(template, index) {
  return /\S$/u.test(template.quasis[index].value.raw) ||
    /^\S/u.test(template.quasis[index + 1].value.raw);
}

export function* getStaticClassText(attribute) {
  for (const value of getClassValues(attribute)) {
    if (value.type === "Literal") {
      yield { node: value, text: value.value };
      continue;
    }

    for (const [index, quasi] of value.quasis.entries()) {
      let text = quasi.value.cooked ?? quasi.value.raw;
      // A token touching an interpolation is only a fragment, not a known class.
      if (index > 0) text = text.replace(/^\S+/u, "");
      if (index < value.expressions.length) text = text.replace(/\S+$/u, "");
      yield { node: quasi, text };
    }
  }
}
