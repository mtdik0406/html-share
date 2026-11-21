import ts from "typescript";

export interface Finding {
  line: number;
  reason: string;
}

const FORBIDDEN_TEXT: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\/(?:Users|home)\/[^/\s]+\//, reason: "マシン固有の絶対パス" },
  { pattern: /学習用|自作版|実験|段階\s*[0-9０-９]/, reason: "作った経緯の言葉" },
];

export function findForbiddenText(text: string): Finding[] {
  return text.split("\n").flatMap((lineText, i) =>
    FORBIDDEN_TEXT.filter(({ pattern }) => pattern.test(lineText)).map(({ reason }) => ({
      line: i + 1,
      reason,
    })),
  );
}

const ERROR_ASSERTIONS = new Set(["throws", "rejects"]);

export function findMessageAssertions(source: string): Finding[] {
  const file = ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ERROR_ASSERTIONS.has(node.expression.name.text)
    ) {
      const expected = node.arguments[1];
      if (expected !== undefined && looksAtMessage(expected)) {
        findings.push({
          line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          reason: "エラーの文言を見ている",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function looksAtMessage(expected: ts.Expression): boolean {
  if (
    ts.isRegularExpressionLiteral(expected) ||
    ts.isStringLiteralLike(expected) ||
    ts.isTemplateExpression(expected)
  ) {
    return true;
  }
  if (ts.isObjectLiteralExpression(expected)) {
    return expected.properties.some((p) => p.name !== undefined && p.name.getText() === "message");
  }
  if (ts.isArrowFunction(expected) || ts.isFunctionExpression(expected)) {
    return readsMessage(expected.body);
  }
  return false;
}

function readsMessage(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node) && node.name.text === "message") return true;
  return ts.forEachChild(node, readsMessage) ?? false;
}

/** 採用した ADR は、置き換えたことを示す「状態」の行のほかは書き換えない。 */
export function adrChangedOutsideStatus(original: string, current: string): boolean {
  const withoutStatus = (text: string) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("- 状態："))
      .join("\n");
  return withoutStatus(original) !== withoutStatus(current);
}
