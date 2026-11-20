// スタックの「安全性の不変条件」を確かめる。どれかが崩れたら、ページが公開されてしまうおそれがある。
// CDK の書き出し方（Fn::Join の形、Action が文字列か配列か、リソースの数）には依存させず、意味で照合する。
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import { OUTPUT_KEYS } from "../lib/names.js";

// biome-ignore lint/suspicious/noExplicitAny: CloudFormation テンプレートは任意の JSON
type Json = any;

/** 値の中に現れる Ref の参照先（論理 ID）をすべて集める。 */
function refsIn(value: Json): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object") {
    if (typeof value.Ref === "string") return [value.Ref];
    return Object.values(value).flatMap(refsIn);
  }
  return [];
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : ([v].flat() as T[]));

describe("HtmlShareStack", () => {
  // .keys/ の本物の鍵に依存しないよう、使い捨ての鍵を作る。
  const { publicKey: publicKeyPem } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  let template: Template;
  const resourcesOf = (type: string): Record<string, Json> => template.findResources(type);
  const bucketPolicyStatements = (): Json[] =>
    Object.values(resourcesOf("AWS::S3::BucketPolicy")).flatMap(
      (r) => r.Properties.PolicyDocument.Statement,
    );
  const behaviorsOf = (distribution: Json): Json[] => [
    distribution.Properties.DistributionConfig.DefaultCacheBehavior,
    ...(distribution.Properties.DistributionConfig.CacheBehaviors ?? []),
  ];

  before(() => {
    template = Template.fromStack(new HtmlShareStack(new App(), "TestStack", { publicKeyPem }));
  });

  it("S3 の公開アクセスを 4 項目ともブロックする", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("S3 は HTTPS 以外の要求を拒否する", () => {
    const denies = bucketPolicyStatements().filter(
      (s) => s.Effect === "Deny" && s.Condition?.Bool?.["aws:SecureTransport"] === "false",
    );
    assert.ok(denies.length > 0);
  });

  it("バケットポリシーは誰にでも（Principal: *）許可を与えない", () => {
    const publicAllows = bucketPolicyStatements().filter(
      (s) => s.Effect === "Allow" && (s.Principal === "*" || s.Principal?.AWS === "*"),
    );
    assert.deepEqual(publicAllows, []);
  });

  it("CloudFront への許可は、このスタックの Distribution に限られ、ページを読める", () => {
    const distributionIds = Object.keys(resourcesOf("AWS::CloudFront::Distribution"));
    const cloudFrontAllows = bucketPolicyStatements().filter(
      (s) =>
        s.Effect === "Allow" && asArray(s.Principal?.Service).includes("cloudfront.amazonaws.com"),
    );

    assert.ok(cloudFrontAllows.some((s) => asArray(s.Action).includes("s3:GetObject")));
    for (const s of cloudFrontAllows) {
      const sourceArnRefs = refsIn(s.Condition?.StringEquals?.["AWS:SourceArn"]);
      assert.ok(sourceArnRefs.length > 0, "SourceArn の条件がない");
      for (const ref of sourceArnRefs.filter((r) => !r.startsWith("AWS::"))) {
        assert.ok(distributionIds.includes(ref), `このスタックにない参照: ${ref}`);
      }
    }
  });

  it("すべてのビヘイビアが署名を必須にし、検証に使う鍵はこのスタックの公開鍵だけ", () => {
    const keyGroups = resourcesOf("AWS::CloudFront::KeyGroup");
    const publicKeys = resourcesOf("AWS::CloudFront::PublicKey");

    for (const distribution of Object.values(resourcesOf("AWS::CloudFront::Distribution"))) {
      for (const behavior of behaviorsOf(distribution)) {
        const trusted = refsIn(behavior.TrustedKeyGroups);
        assert.ok(trusted.length > 0, `署名不要のビヘイビア: ${behavior.PathPattern ?? "default"}`);
        for (const keyGroupId of trusted) {
          const items = refsIn(keyGroups[keyGroupId]?.Properties.KeyGroupConfig.Items);
          assert.ok(items.length > 0);
          for (const keyId of items) assert.ok(keyId in publicKeys, `不明な鍵: ${keyId}`);
        }
      }
    }
    assert.ok(
      Object.values(publicKeys).some(
        (k) => k.Properties.PublicKeyConfig.EncodedKey === publicKeyPem,
      ),
      "渡した公開鍵が登録されていない",
    );
  });

  it("すべてのビヘイビアが HTTP を受け付けない", () => {
    for (const distribution of Object.values(resourcesOf("AWS::CloudFront::Distribution"))) {
      for (const behavior of behaviorsOf(distribution)) {
        assert.ok(["redirect-to-https", "https-only"].includes(behavior.ViewerProtocolPolicy));
      }
    }
  });

  it("スクリプトが読む出力を持つ", () => {
    for (const key of Object.values(OUTPUT_KEYS)) {
      template.hasOutput(key, {});
    }
  });
});
