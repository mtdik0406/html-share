import type { Template } from "aws-cdk-lib/assertions";

// biome-ignore lint/suspicious/noExplicitAny: CloudFormation テンプレートは任意の JSON
export type Json = any;

export function refsIn(value: Json): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object") {
    if (typeof value.Ref === "string") return [value.Ref];
    if (Array.isArray(value["Fn::GetAtt"])) return [value["Fn::GetAtt"][0]];
    return Object.values(value).flatMap(refsIn);
  }
  return [];
}

export const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : ([v].flat() as T[]);

/** ロールの権限になる文：ロールを指すポリシー（インライン・カスタマー管理・RolePolicy）と、ロール自身の Policies。 */
export function roleStatements(template: Template, roleId: string): Json[] {
  const of = (type: string): Json[] => Object.values(template.findResources(type));
  const role = template.findResources("AWS::IAM::Role")[roleId];
  return [...of("AWS::IAM::Policy"), ...of("AWS::IAM::ManagedPolicy")]
    .filter((p) => refsIn(p.Properties.Roles).includes(roleId))
    .concat(
      of("AWS::IAM::RolePolicy").filter((p) => refsIn(p.Properties.RoleName).includes(roleId)),
      asArray<Json>(role?.Properties.Policies),
    )
    .flatMap((p) => p.PolicyDocument?.Statement ?? p.Properties.PolicyDocument.Statement);
}
