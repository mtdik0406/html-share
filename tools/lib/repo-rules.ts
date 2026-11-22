import ts from "typescript";

export interface Finding {
  line: number;
  reason: string;
}

const FORBIDDEN_TEXT: readonly { pattern: RegExp; reason: string }[] = [
  // Stryker disable next-line StringLiteral: 表示の文言
  { pattern: /\/(?:Users|home)\/[^/\s]+\//, reason: "マシン固有の絶対パス" },
  // Stryker disable next-line StringLiteral: 表示の文言
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
  // Stryker disable next-line StringLiteral: 解析に使わない仮のファイル名
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
          // Stryker disable next-line StringLiteral: 表示の文言
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

/** 文書と skill が、ない script や skill を指していないか。名前を変えたときに、古い参照が残らないように。 */
export function findMissingReferences(
  text: string,
  known: { scripts: ReadonlySet<string>; skills: ReadonlySet<string> },
): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((lineText, i) => {
    for (const [, name] of lineText.matchAll(/pnpm run ([\w:-]+)/g)) {
      if (!known.scripts.has(name as string)) {
        // Stryker disable next-line StringLiteral: 表示の文言
        findings.push({ line: i + 1, reason: `ない script: ${name}` });
      }
    }
    for (const [, name] of lineText.matchAll(/`([\w-]+)` の skill/g)) {
      if (!known.skills.has(name as string)) {
        // Stryker disable next-line StringLiteral: 表示の文言
        findings.push({ line: i + 1, reason: `ない skill: ${name}` });
      }
    }
  });
  return findings;
}

/** 手元の秘密鍵を読んでよいのは、鍵を作るときと SSM に置くときだけ。署名は Lambda が SSM の鍵で行う（ADR 9）。 */
const PRIVATE_KEY_READERS = new Set([
  "core/paths.ts",
  "cli/lib/keygen.ts",
  "cli/keys-store.ts",
  "test/cli/lib/keygen.test.ts",
]);

export function findPrivateKeyAccess(path: string, text: string): Finding[] {
  if (!path.endsWith(".ts") || PRIVATE_KEY_READERS.has(path)) return [];
  return text.split("\n").flatMap((lineText, i) =>
    /\bPRIVATE_KEY_(?:PATH|FILE)\b/.test(lineText)
      ? // Stryker disable next-line StringLiteral: 表示の文言
        [{ line: i + 1, reason: "秘密鍵の場所を参照している（署名は Lambda が行う）" }]
      : [],
  );
}
