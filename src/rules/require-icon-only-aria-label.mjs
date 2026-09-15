export function createRequireIconOnlyAriaLabel(designSystemName) {
  return {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        missing:
          "Design-system Button is iconOnly but has no accessible name; add an aria-label that describes the action.",
      },
    },
    create(context) {
      const importedButtons = new Set();

      return {
        Program(node) {
          for (const statement of node.body) {
            collectButtonImports(
              statement,
              designSystemName,
              importedButtons,
            );
          }
        },
        JSXOpeningElement(node) {
          if (
            node.name.type !== "JSXIdentifier" ||
            !importedButtons.has(node.name.name)
          ) {
            return;
          }

          if (
            node.attributes.some(
              (attribute) => attribute.type === "JSXSpreadAttribute",
            )
          ) {
            return;
          }

          const asChild = getStaticBooleanAttribute(node, "asChild");

          if (asChild === true || asChild === undefined) {
            return;
          }

          const iconOnly = getStaticBooleanAttribute(node, "iconOnly");
          const dismiss = getStaticBooleanAttribute(node, "dismiss");

          if (iconOnly !== true && dismiss !== true) {
            return;
          }

          if (getAttribute(node, "aria-label") !== null) {
            return;
          }

          context.report({
            node: node.name,
            messageId: "missing",
          });
        },
      };
    },
  };
}

function collectButtonImports(statement, designSystemName, importedButtons) {
  if (
    statement.type !== "ImportDeclaration" ||
    typeof statement.source.value !== "string" ||
    !isButtonModule(statement.source.value, designSystemName)
  ) {
    return;
  }

  for (const specifier of statement.specifiers) {
    if (
      specifier.type === "ImportSpecifier" &&
      getImportedName(specifier) === "Button"
    ) {
      importedButtons.add(specifier.local.name);
    }
  }
}

function isButtonModule(moduleName, designSystemName) {
  return (
    moduleName === designSystemName ||
    moduleName === `${designSystemName}/components/Button`
  );
}

function getImportedName(specifier) {
  if (specifier.imported.type === "Identifier") {
    return specifier.imported.name;
  }

  return specifier.imported.value;
}

function getStaticBooleanAttribute(node, name) {
  const attribute = getAttribute(node, name);

  if (attribute === null) {
    return false;
  }

  if (attribute.value === null) {
    return true;
  }

  if (
    attribute.value.type === "JSXExpressionContainer" &&
    attribute.value.expression.type === "Literal" &&
    typeof attribute.value.expression.value === "boolean"
  ) {
    return attribute.value.expression.value;
  }

  return undefined;
}

function getAttribute(node, name) {
  return (
    node.attributes.find(
      (attribute) =>
        attribute.type === "JSXAttribute" &&
        attribute.name.type === "JSXIdentifier" &&
        attribute.name.name === name,
    ) ?? null
  );
}
