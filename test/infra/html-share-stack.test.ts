// スタックの「安全性の不変条件」を確かめる。どれかが崩れたら、ページが公開されてしまうおそれがある。
// CDK の書き出し方（Fn::Join の形、Action が文字列か配列か、リソースの数）には依存させず、意味で照合する。
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { before, describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { MIME_TYPES } from "../../cli/lib/embed.js";
import { OUTPUT_KEYS, SIGN_FUNCTION_ENV, signingKeyParameterName } from "../../core/names.js";
import { HtmlShareStack } from "../../infra/html-share-stack.js";
import { TEST_ADMIN } from "../helpers/stack.js";
import { asArray, type Json, refsIn, roleStatements } from "../helpers/template.js";

/** バケットのポリシーの文が、CloudFront のサービスに許しているか。Principal.Service は文字列か配列なので、要素の完全一致で見る。 */
function allowsCloudFront(s: Json): boolean {
  return (
    s.Effect === "Allow" &&
    asArray<string>(s.Principal?.Service).some((service) => service === "cloudfront.amazonaws.com")
  );
}

function assertNoExternalAccess(
  directives: Map<string, string[]>,
  allowedDirectives: ReadonlySet<string>,
  allowedSources: ReadonlySet<string>,
): void {
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

function directiveFor(mime: string): string | undefined {
  if (mime === "text/javascript") return "script-src";
  if (mime === "text/css") return "style-src";
  if (mime === "text/vtt") return "media-src";
  if (mime.startsWith("image/")) return "img-src";
  if (mime.startsWith("font/")) return "font-src";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media-src";
  return undefined;
}

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
  // 管理画面の Distribution は test/infra/admin-console.test.ts で確かめる。ここでは閲覧用だけを見る。
  const viewerDistributions = (): [string, Json][] => {
    const found = Object.entries(resourcesOf("AWS::CloudFront::Distribution")).filter(
      ([, d]) => d.Properties.DistributionConfig.Comment === "html-share viewer",
    );
    assert.equal(found.length, 1, "閲覧用の Distribution が 1 つでない");
    return found;
  };
  const behaviorsOf = (distribution: Json): Json[] => [
    distribution.Properties.DistributionConfig.DefaultCacheBehavior,
    ...(distribution.Properties.DistributionConfig.CacheBehaviors ?? []),
  ];

  before(() => {
    template = Template.fromStack(
      new HtmlShareStack(new App(), "TestStack", {
        publicKeyPem,
        signingKeyGeneration: 1,
        admin: TEST_ADMIN,
      }),
    );
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
    const cloudFrontAllows = bucketPolicyStatements().filter(allowsCloudFront);

    assert.ok(cloudFrontAllows.some((s) => asArray(s.Action).includes("s3:GetObject")));
    for (const s of cloudFrontAllows) {
      const sourceArnRefs = refsIn(s.Condition?.StringEquals?.["AWS:SourceArn"]);
      assert.ok(sourceArnRefs.length > 0, "SourceArn の条件がない");
      for (const ref of sourceArnRefs.filter((r) => !r.startsWith("AWS::"))) {
        assert.ok(distributionIds.includes(ref), `このスタックにない参照: ${ref}`);
      }
    }
  });

  it("ページのバケットを読めるのは、閲覧用の Distribution だけ（sandbox のない管理画面には読ませない）", () => {
    const contentBucketIds = Object.keys(resourcesOf("AWS::S3::Bucket")).filter((id) =>
      id.startsWith("ContentBucket"),
    );
    assert.equal(contentBucketIds.length, 1);
    const policies = Object.values(resourcesOf("AWS::S3::BucketPolicy")).filter((p) =>
      refsIn(p.Properties.Bucket).includes(contentBucketIds[0] as string),
    );
    const allows = policies
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter(allowsCloudFront);
    assert.ok(allows.length > 0);
    const [[viewerId]] = viewerDistributions();
    for (const s of allows) {
      const refs = refsIn(s.Condition?.StringEquals?.["AWS:SourceArn"]).filter(
        (r) => !r.startsWith("AWS::"),
      );
      assert.deepEqual(refs, [viewerId]);
    }
  });

  it("CloudFront に許すのはページの読み取りだけ（書き換えも削除もさせない）", () => {
    const cloudFrontAllows = bucketPolicyStatements().filter(allowsCloudFront);
    assert.ok(cloudFrontAllows.length > 0);
    for (const s of cloudFrontAllows) {
      assert.deepEqual(asArray(s.Action), ["s3:GetObject"]);
    }
    for (const [, distribution] of viewerDistributions()) {
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

    for (const [, distribution] of viewerDistributions()) {
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
    const behaviors = viewerDistributions().flatMap(([, d]) => behaviorsOf(d));
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

  /** ヘッダー名は大文字と小文字を区別しないので、小文字にそろえて引く。 */
  const customHeadersOf = (config: Json): Map<string, Json> =>
    new Map(config.CustomHeadersConfig.Items.map((h: Json) => [h.Header.toLowerCase(), h]));

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
      assertNoExternalAccess(
        parseCsp(config.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy),
        allowedDirectives,
        allowedSources,
      );
    }
  });

  it("埋め込める素材の種類は、どれも CSP で data: として読み込める", () => {
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
      const headers = customHeadersOf(config);
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

  it("すべてのビヘイビアが、ページを開いたウィンドウとつながらせず、端末の機能を使わせない", () => {
    for (const config of responseHeadersPoliciesOfBehaviors()) {
      const headers = customHeadersOf(config);
      assert.equal(headers.get("cross-origin-opener-policy")?.Value, "same-origin");
      const permissions = new Map<string, string>(
        (headers.get("permissions-policy")?.Value ?? "")
          .split(/\s*,\s*/)
          .map((entry: string) => entry.split("=") as [string, string]),
      );
      for (const feature of [
        "camera",
        "microphone",
        "geolocation",
        "display-capture",
        "usb",
        "serial",
        "hid",
        "bluetooth",
        "payment",
        "midi",
        // 端末のセンサーは、許可を求めずに読めるブラウザがある。
        "accelerometer",
        "gyroscope",
        "magnetometer",
        "ambient-light-sensor",
        "local-fonts",
        "window-management",
        "screen-wake-lock",
        "idle-detection",
        "xr-spatial-tracking",
        "publickey-credentials-get",
        "publickey-credentials-create",
        "web-share",
        "identity-credentials-get",
        "otp-credentials",
        "browsing-topics",
      ]) {
        assert.equal(permissions.get(feature), "()", `${feature} を止めていない`);
      }
      for (const name of ["cross-origin-opener-policy", "permissions-policy"]) {
        assert.equal(headers.get(name)?.Override, true, `${name} がオリジンの値に負ける`);
      }
    }
  });

  const signFunctionOf = (t: Template): [string, Json] => {
    const functions = Object.entries(t.findResources("AWS::Lambda::Function")).filter(([id]) =>
      id.startsWith("SignFunction"),
    );
    assert.equal(functions.length, 1, "署名の Lambda が 1 つでない");
    return functions[0] as [string, Json];
  };
  const signFunction = (): Json => signFunctionOf(template)[1];

  it("署名の Lambda は、このスタックの公開鍵の ID と Distribution のドメインで署名する", () => {
    const variables = signFunction().Properties.Environment.Variables;
    assert.equal(variables[SIGN_FUNCTION_ENV.parameterName], signingKeyParameterName(1));
    const publicKeyIds = Object.keys(resourcesOf("AWS::CloudFront::PublicKey"));
    assert.deepEqual(refsIn(variables[SIGN_FUNCTION_ENV.keyPairId]), publicKeyIds);
    const [[distributionId]] = viewerDistributions();
    assert.deepEqual(variables[SIGN_FUNCTION_ENV.distributionDomainName], {
      "Fn::GetAtt": [distributionId, "DomainName"],
    });
  });

  it("署名の Lambda のログは 30 日で消える", () => {
    const logGroupRefs = refsIn(signFunction().Properties.LoggingConfig?.LogGroup);
    assert.equal(logGroupRefs.length, 1, "ログの置き場所を指定していない");
    const logGroup = resourcesOf("AWS::Logs::LogGroup")[logGroupRefs[0] as string];
    assert.equal(logGroup?.Properties.RetentionInDays, 30);
  });

  it("署名の Lambda は Node.js 26 で動く", () => {
    assert.equal(signFunction().Properties.Runtime, "nodejs26.x");
  });

  it("署名の Lambda のロールに許すのは、鍵のパラメータを読むことだけ", () => {
    // ロールは Fn::GetAtt [論理 ID, "Arn"] で参照される。
    const roleId: string | undefined = signFunction().Properties.Role["Fn::GetAtt"]?.[0];
    assert.ok(roleId, "ロールが見つからない");
    const role = resourcesOf("AWS::IAM::Role")[roleId];
    const statements = roleStatements(template, roleId);
    assert.ok(statements.length > 0, "鍵を読む許可がない");
    for (const statement of statements) {
      assert.equal(statement.Effect, "Allow");
      assert.deepEqual(asArray(statement.Action), ["ssm:GetParameter"]);
      const resource = JSON.stringify(statement.Resource);
      assert.ok(resource.includes(":ssm:"), resource);
      assert.ok(resource.includes(`:parameter${signingKeyParameterName(1)}"`), resource);
      assert.ok(!resource.includes("*"), `Resource にワイルドカードがある: ${resource}`);
    }
    // 管理ポリシーは、ログを書くための AWS 管理ポリシー 1 つだけ。
    const managed = asArray<Json>(role.Properties.ManagedPolicyArns);
    assert.equal(managed.length, 1, `管理ポリシーが 1 つでない: ${JSON.stringify(managed)}`);
    assert.match(
      JSON.stringify(managed[0]),
      /:iam::aws:policy\/service-role\/AWSLambdaBasicExecutionRole"/,
    );
  });

  it("署名の Lambda は、IAM で認められた呼び出しだけを受ける", () => {
    // Function URL や、アカウントの外への呼び出しの許可があると、誰でも URL を作れてしまう。
    const [signId] = signFunctionOf(template);
    for (const type of ["AWS::Lambda::Url", "AWS::Lambda::Permission"]) {
      for (const r of Object.values(resourcesOf(type))) {
        const target = r.Properties.TargetFunctionArn ?? r.Properties.FunctionName;
        assert.ok(!refsIn(target).includes(signId), `${type} が署名の Lambda を指す`);
      }
    }
  });

  describe("鍵の世代", () => {
    const templateFor = (signingKeyGeneration: number): Template =>
      Template.fromStack(
        new HtmlShareStack(new App(), "TestStack", {
          publicKeyPem,
          signingKeyGeneration,
          admin: TEST_ADMIN,
        }),
      );
    const publicKeyIds = (t: Template): string[] =>
      Object.keys(t.findResources("AWS::CloudFront::PublicKey"));

    it("1 世代目の公開鍵は、デプロイ済みの公開鍵と同じ論理 ID のまま（作り直さない）", () => {
      assert.deepEqual(publicKeyIds(template), ["SigningPublicKey89B1E9A4"]);
    });

    it("世代を変えると、別の名前の公開鍵になる（中身を変えられないので、作り直させる）", () => {
      const second = templateFor(2);
      const [secondId] = publicKeyIds(second);
      assert.ok(secondId);
      assert.notDeepEqual([secondId], publicKeyIds(template));
      const nameOf = (t: Template) =>
        Object.values(t.findResources("AWS::CloudFront::PublicKey"))[0]?.Properties.PublicKeyConfig
          .Name;
      assert.notEqual(nameOf(second), nameOf(template));
    });

    it("世代を変えても、キーグループと Distribution は同じ論理 ID のまま", () => {
      const second = templateFor(2);
      for (const type of ["AWS::CloudFront::KeyGroup", "AWS::CloudFront::Distribution"]) {
        assert.deepEqual(
          Object.keys(second.findResources(type)),
          Object.keys(template.findResources(type)),
        );
      }
    });

    it("署名の Lambda は、その世代の鍵のパラメータだけを読む", () => {
      const second = templateFor(2);
      const [, fn] = signFunctionOf(second);
      assert.equal(
        fn?.Properties.Environment.Variables[SIGN_FUNCTION_ENV.parameterName],
        signingKeyParameterName(2),
      );
      const resources = JSON.stringify(
        Object.values(second.findResources("AWS::IAM::Policy")).flatMap(
          (p) => p.Properties.PolicyDocument.Statement,
        ),
      );
      assert.ok(resources.includes(`:parameter${signingKeyParameterName(2)}"`), resources);
      assert.ok(!resources.includes(`:parameter${signingKeyParameterName(1)}"`), resources);
    });

    it("世代を変えると、キーグループと署名の Lambda は新しい公開鍵を指す", () => {
      const second = templateFor(2);
      const [publicKeyId] = publicKeyIds(second);
      const [keyGroup] = Object.values(second.findResources("AWS::CloudFront::KeyGroup"));
      assert.deepEqual(refsIn(keyGroup?.Properties.KeyGroupConfig.Items), [publicKeyId]);
      const [, fn] = signFunctionOf(second);
      assert.deepEqual(refsIn(fn?.Properties.Environment.Variables[SIGN_FUNCTION_ENV.keyPairId]), [
        publicKeyId,
      ]);
    });

    it("世代が 1 以上の整数でなければ、スタックを作らない", () => {
      for (const signingKeyGeneration of [0, -1, 1.5, Number.NaN]) {
        assert.throws(() => templateFor(signingKeyGeneration));
      }
    });
  });

  it("スクリプトが読む出力を持つ", () => {
    for (const key of Object.values(OUTPUT_KEYS)) {
      template.hasOutput(key, {});
    }
  });
});
