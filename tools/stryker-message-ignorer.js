import { declareValuePlugin, PluginKind } from "@stryker-mutator/api/plugin";

// テストはエラーと警告の文言を見ない（AGENTS.md）ので、文言を変える変異は必ず生き残る。
// 文言の引数だけを外し、エラーを投げること・警告を積むことの変異は残す。
const isErrorConstructor = (node) =>
  node.type === "NewExpression" &&
  node.callee.type === "Identifier" &&
  /Error$/.test(node.callee.name);

const isMessageCall = (node) => {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return false;
  const { object, property } = node.callee;
  if (property.type !== "Identifier") return false;
  const warningsPush =
    property.name === "push" &&
    object.type === "MemberExpression" &&
    object.property.name === "warnings";
  const consoleError =
    property.name === "error" && object.type === "Identifier" && object.name === "console";
  return warningsPush || consoleError;
};

export const strykerPlugins = [
  declareValuePlugin(PluginKind.Ignore, "messages", {
    shouldIgnore(path) {
      if (path.listKey !== "arguments") return undefined;
      const parent = path.parentPath.node;
      return isErrorConstructor(parent) || isMessageCall(parent)
        ? "エラーと警告の文言はテストで見ない"
        : undefined;
    },
  }),
];
