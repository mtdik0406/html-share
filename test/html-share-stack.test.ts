// スタックの「安全性の不変条件」を確かめる。どれかが崩れたら、ページが公開されてしまうおそれがある。
// CDK の書き出し方（Fn::Join の形、Action が文字列か配列か、リソースの数）には依存させず、意味で照合する。
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import { OUTPUT_KEYS } from "../lib/names.js";
import { MIME_TYPES } from "../scripts/lib/embed.js";

// biome-ignore lint/suspicious/noExplicitAny: CloudFormation テンプレートは任意の JSON
type Json = any;

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

  it("CloudFront に許すのはページの読み取りだけ（書き換えも削除もさせない）", () => {
    const cloudFrontAllows = bucketPolicyStatements().filter(
      (s) =>
        s.Effect === "Allow" && asArray(s.Principal?.Service).includes("cloudfront.amazonaws.com"),
    );
    assert.ok(cloudFrontAllows.length > 0);
    for (const s of cloudFrontAllows) {
      assert.deepEqual(asArray(s.Action), ["s3:GetObject"]);
    }
    for (const distribution of Object.values(resourcesOf("AWS::CloudFront::Distribution"))) {
      for (const behavior of behaviorsOf(distribution)) {
        // 省略時の既定は GET と HEAD。
        for (const method of asArray<string>(behavior.AllowedMethods)) {
          assert.ok(["GET", "HEAD"].includes(method), `${method} を受け付ける`);
        }
      }
    }
  });

  it("すべてのビヘイビアがエッジでキャッシュしない（消したページや上書き前の中身を見せ続けない）", () => {
    // AWS が管理するキャッシュポリシー CachingDisabled の ID。
    const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
    for (const distribution of Object.values(resourcesOf("AWS::CloudFront::Distribution"))) {
      for (const behavior of behaviorsOf(distribution)) {
        assert.equal(behavior.CachePolicyId, CACHING_DISABLED);
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

  /** 並び順や空白の違いでテストが壊れないよう、ディレクティブ名ごとに分ける。 */
  const parseCsp = (csp: string): Map<string, string[]> => {
    const directives = new Map<string, string[]>();
    for (const directive of csp.split(";")) {
      const [name, ...values] = directive.trim().split(/\s+/);
      if (!name) continue;
      const key = name.toLowerCase();
      // ブラウザは最初の 1 つに従い、2 つ目以降を無視する。テストが見る方と食い違わないよう、重複そのものを拒む。
      assert.ok(!directives.has(key), `${key} が 2 回ある`);
      directives.set(
        key,
        values.map((v) => v.toLowerCase()),
      );
    }
    return directives;
  };

  const responseHeadersPoliciesOfBehaviors = (): Json[] => {
    const policies = resourcesOf("AWS::CloudFront::ResponseHeadersPolicy");
    const behaviors = Object.values(resourcesOf("AWS::CloudFront::Distribution")).flatMap(
      behaviorsOf,
    );
    // 空だと、呼び出し側のループが何も確かめずに成功する。
    assert.ok(behaviors.length > 0, "ビヘイビアが見つからない");
    return behaviors.map((behavior) => {
      const [ref] = refsIn(behavior.ResponseHeadersPolicyId);
      assert.ok(
        ref && ref in policies,
        `このスタックのヘッダーポリシーがない: ${behavior.PathPattern ?? "default"}`,
      );
      return policies[ref].Properties.ResponseHeadersPolicyConfig;
    });
  };

  it("すべてのビヘイビアが、ページを sandbox に入れ、許す操作はスクリプトの実行だけ", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const csp = config.SecurityHeadersConfig.ContentSecurityPolicy;
      assert.equal(csp.Override, true);
      const sandbox = parseCsp(csp.ContentSecurityPolicy).get("sandbox");
      assert.ok(sandbox, "sandbox がない");
      // allow-same-origin があると Cookie と localStorage に触れ、allow-forms があると送信できる。
      // 新しいタブ・ダウンロード・ダイアログも許さない。足すなら、このテストを変える判断を伴う。
      for (const token of sandbox) {
        assert.ok(token === "allow-scripts", `sandbox に ${token} がある`);
      }
    }
  });

  it("すべてのビヘイビアが、外部から何も読ませず、外へ何も送らせない", () => {
    const allowedSources = new Set(["'none'", "'unsafe-inline'", "data:"]);
    // 知らない名前を拒む。report-uri・report-to のように、違反の報告（署名付き URL を含む）を外へ送らせるものがあるため。
    const allowedDirectives = new Set([
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "media-src",
      "connect-src",
      "form-action",
      "frame-ancestors",
      "base-uri",
      "sandbox",
    ]);
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const directives = parseCsp(
        config.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
      );

      // 個別に書いていない種類の読み込みは default-src に従う。
      assert.deepEqual(directives.get("default-src"), ["'none'"]);
      for (const name of directives.keys()) {
        assert.ok(allowedDirectives.has(name), `想定していないディレクティブ: ${name}`);
      }
      for (const [name, sources] of directives) {
        // script-src-elem・style-src-attr のように -src の後ろに続く名前もある。
        if (!name.includes("-src")) continue;
        for (const source of sources) {
          assert.ok(allowedSources.has(source), `${name} が ${source} を許している`);
        }
      }
      // form-action・frame-ancestors・base-uri は default-src に従わない。
      // connect-src は従うが、外への送信の要なので、default-src が緩んでも残るよう個別に固定する。
      for (const name of ["connect-src", "form-action", "frame-ancestors", "base-uri"]) {
        assert.deepEqual(directives.get(name), ["'none'"], `${name} が 'none' でない`);
      }
    }
  });

  it("埋め込める素材の種類は、どれも CSP で data: として読み込める", () => {
    const directiveFor = (mime: string): string | undefined => {
      if (mime === "text/javascript") return "script-src";
      if (mime === "text/css") return "style-src";
      if (mime === "text/vtt") return "media-src";
      if (mime.startsWith("image/")) return "img-src";
      if (mime.startsWith("font/")) return "font-src";
      if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media-src";
      return undefined;
    };
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const directives = parseCsp(
        config.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
      );
      for (const mime of new Set(Object.values(MIME_TYPES))) {
        const directive = directiveFor(mime);
        assert.ok(directive, `CSP のどのディレクティブで読むか決めていない種類: ${mime}`);
        assert.ok(directives.get(directive)?.includes("data:"), `${directive} が data: を許さない`);
      }
    }
  });

  it("すべてのビヘイビアが、署名付き URL を Referer で漏らさない", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const referrer = config.SecurityHeadersConfig.ReferrerPolicy;
      assert.equal(referrer.ReferrerPolicy, "no-referrer");
      assert.equal(referrer.Override, true);
    }
  });

  it("すべてのビヘイビアが、ブラウザに保存させず、検索エンジンに載せない", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const headers = new Map<string, Json>(
        config.CustomHeadersConfig.Items.map((h: Json) => [h.Header.toLowerCase(), h]),
      );
      const tokensOf = (name: string): string[] => headers.get(name)?.Value.split(/\s*,\s*/) ?? [];
      assert.ok(tokensOf("cache-control").includes("no-store"));
      assert.ok(tokensOf("x-robots-tag").includes("noindex"));
      for (const name of ["cache-control", "x-robots-tag"]) {
        assert.equal(headers.get(name).Override, true, `${name} がオリジンの値に負ける`);
      }
      assert.equal(config.SecurityHeadersConfig.StrictTransportSecurity.Override, true);
    }
  });

  it("すべてのビヘイビアが、Content-Type と違う種類のファイルとして解釈させない", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      assert.equal(config.SecurityHeadersConfig.ContentTypeOptions?.Override, true);
    }
  });

  it("すべてのビヘイビアが、ほかのサイトに埋め込ませない", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      // CSP の frame-ancestors を解さない古いブラウザ向け。
      const frameOptions = config.SecurityHeadersConfig.FrameOptions;
      assert.equal(frameOptions?.FrameOption, "DENY");
      assert.equal(frameOptions?.Override, true);
    }
  });

  it("スクリプトが読む出力を持つ", () => {
    for (const key of Object.values(OUTPUT_KEYS)) {
      template.hasOutput(key, {});
    }
  });
});
