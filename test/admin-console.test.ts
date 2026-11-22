// 管理画面の「安全性の不変条件」を、テンプレートの意味で確かめる（ADR 13）。
// どれかが崩れると、所有者でない人が URL を発行できたり、ページを書き換えられたりするおそれがある。
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { parseAdminConfig } from "../lib/admin/admin-config.js";
import { adminUiFiles } from "../lib/admin-console.js";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import {
  ADMIN_CONFIG_PARAMETER_NAME,
  ADMIN_FUNCTION_ENV,
  ADMIN_PATHS,
  OUTPUT_KEYS,
  signingKeyParameterName,
} from "../lib/names.js";
import { PAGES_PREFIX } from "../scripts/lib/page.js";
import { generateTestKeyPair } from "./helpers/keys.js";
import { TEST_ADMIN } from "./helpers/stack.js";
import { asArray, type Json, refsIn, resolveString, roleStatements } from "./helpers/template.js";

const REGION = "ap-northeast-1";
const RP_ID = `${TEST_ADMIN.cognitoDomainPrefix}.auth.${REGION}.amazoncognito.com`;

describe("管理画面", () => {
  let template: Template;
  const resourcesOf = (type: string): Record<string, Json> => template.findResources(type);
  const one = (type: string): [string, Json] => {
    const entries = Object.entries(resourcesOf(type));
    assert.equal(entries.length, 1, `${type} が 1 つでない`);
    return entries[0] as [string, Json];
  };
  const distributionWithComment = (comment: string): [string, Json] => {
    const found = Object.entries(resourcesOf("AWS::CloudFront::Distribution")).filter(
      ([, d]) => d.Properties.DistributionConfig.Comment === comment,
    );
    assert.equal(found.length, 1, `${comment} の Distribution が 1 つでない`);
    return found[0] as [string, Json];
  };
  const admin = () => distributionWithComment("html-share admin");
  const viewer = () => distributionWithComment("html-share viewer");
  const behaviors = (): Map<string, Json> => {
    const config = admin()[1].Properties.DistributionConfig;
    return new Map<string, Json>([
      ["default", config.DefaultCacheBehavior],
      ...(config.CacheBehaviors ?? []).map((b: Json) => [b.PathPattern, b] as [string, Json]),
    ]);
  };
  const functionWithEnv = (name: string, value?: string): [string, Json] => {
    const found = Object.entries(resourcesOf("AWS::Lambda::Function")).filter(([, f]) => {
      const v = f.Properties.Environment?.Variables?.[name];
      return value === undefined ? v !== undefined : v === value;
    });
    assert.equal(found.length, 1, `${name} を持つ Lambda が 1 つでない`);
    return found[0] as [string, Json];
  };
  const authFunction = () =>
    functionWithEnv(ADMIN_FUNCTION_ENV.configParameterName, ADMIN_CONFIG_PARAMETER_NAME);
  const pagesFunction = () => functionWithEnv(ADMIN_FUNCTION_ENV.bucketName);
  const statementsOf = (fn: Json): Json[] =>
    roleStatements(template, fn.Properties.Role["Fn::GetAtt"][0]);
  const originOf = (behavior: Json): Json =>
    admin()[1].Properties.DistributionConfig.Origins.find(
      (o: Json) => o.Id === behavior.TargetOriginId,
    );

  before(() => {
    const app = new App();
    template = Template.fromStack(
      new HtmlShareStack(app, "AdminTestStack", {
        env: { account: "111111111111", region: REGION },
        publicKeyPem: generateTestKeyPair().publicKey,
        signingKeyGeneration: 1,
        admin: TEST_ADMIN,
      }),
    );
  });

  describe("Distribution", () => {
    it("画面と API は、閲覧用と同じキーグループの署名を求め、サインインの入口だけは求めない", () => {
      const viewerKeyGroups = refsIn(
        viewer()[1].Properties.DistributionConfig.DefaultCacheBehavior.TrustedKeyGroups,
      );
      assert.equal(viewerKeyGroups.length, 1);
      const b = behaviors();
      assert.deepEqual(
        [...b.keys()].sort(),
        [ADMIN_PATHS.pagesApiPattern, ADMIN_PATHS.authPattern, "default"].sort(),
      );
      for (const path of ["default", ADMIN_PATHS.pagesApiPattern]) {
        assert.deepEqual(refsIn(b.get(path).TrustedKeyGroups), viewerKeyGroups, path);
      }
      assert.deepEqual(refsIn(b.get(ADMIN_PATHS.authPattern).TrustedKeyGroups), []);
    });

    it("画面は、ページとは別のバケットから配る", () => {
      const origin = originOf(behaviors().get("default"));
      const buckets = refsIn(origin.DomainName);
      assert.equal(buckets.length, 1);
      assert.ok((buckets[0] as string).startsWith("AdminUiBucket"), buckets[0]);
    });

    it("Lambda には、Host を除いた閲覧者の要求（Cookie とクエリを含む）を渡す", () => {
      // AWS が管理するオリジンリクエストポリシー AllViewerExceptHostHeader の ID。
      // Function URL は、Host が自分のものでない要求を受け付けない。
      const ALL_VIEWER_EXCEPT_HOST_HEADER = "b689b0a8-53d0-40ab-baf2-68738e2966ac";
      for (const path of [ADMIN_PATHS.authPattern, ADMIN_PATHS.pagesApiPattern]) {
        assert.equal(
          behaviors().get(path).OriginRequestPolicyId,
          ALL_VIEWER_EXCEPT_HOST_HEADER,
          path,
        );
      }
    });

    it("POST を受けるのは URL の発行の API だけで、HTTP は受け付けない", () => {
      for (const [path, behavior] of behaviors()) {
        assert.ok(
          ["redirect-to-https", "https-only"].includes(behavior.ViewerProtocolPolicy),
          path,
        );
        const methods = asArray<string>(behavior.AllowedMethods);
        assert.equal(methods.includes("POST"), path === "/api/pages/*", path);
      }
    });

    it("Lambda は OAC で署名した CloudFront の要求だけを受ける", () => {
      const urls = Object.values(resourcesOf("AWS::Lambda::Url"));
      assert.equal(urls.length, 2);
      for (const url of urls) assert.equal(url.Properties.AuthType, "AWS_IAM");
      const oacs = resourcesOf("AWS::CloudFront::OriginAccessControl");
      for (const path of ["/auth/*", "/api/pages/*"]) {
        const [oacId] = refsIn(originOf(behaviors().get(path)).OriginAccessControlId);
        const config = oacs[oacId as string]?.Properties.OriginAccessControlConfig;
        assert.equal(config?.OriginAccessControlOriginType, "lambda", path);
        assert.equal(config?.SigningBehavior, "always", path);
      }
      const [adminId] = admin();
      const permissions = Object.values(resourcesOf("AWS::Lambda::Permission"));
      assert.ok(permissions.length > 0);
      for (const p of permissions) {
        assert.equal(p.Properties.Principal, "cloudfront.amazonaws.com");
        assert.ok(refsIn(p.Properties.SourceArn).includes(adminId), "管理画面以外から呼べる");
      }
    });

    const headersConfig = (): Json => {
      const [policyId] = refsIn(behaviors().get("default").ResponseHeadersPolicyId);
      for (const behavior of behaviors().values()) {
        assert.deepEqual(refsIn(behavior.ResponseHeadersPolicyId), [policyId]);
      }
      return resourcesOf("AWS::CloudFront::ResponseHeadersPolicy")[policyId as string].Properties
        .ResponseHeadersPolicyConfig;
    };

    it("画面はインラインのスクリプトも外部の読み込みも許さない", () => {
      const csp = new Map<string, string[]>(
        String(headersConfig().SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy)
          .split(";")
          .map((d) => d.trim().split(/\s+/))
          .map(([name, ...values]) => [name as string, values]),
      );
      assert.deepEqual(csp.get("default-src"), ["'none'"]);
      for (const [name, values] of csp) {
        for (const value of values) {
          assert.ok(["'self'", "'none'"].includes(value), `${name} が ${value} を許している`);
        }
      }
      for (const name of ["frame-ancestors", "base-uri", "form-action"]) {
        assert.deepEqual(csp.get(name), ["'none'"], name);
      }
    });

    it("閲覧用と同じく、漏らさず・保存させず・埋め込ませず・端末の機能を使わせない", () => {
      const config = headersConfig();
      assert.equal(config.SecurityHeadersConfig.ReferrerPolicy.ReferrerPolicy, "no-referrer");
      const custom = new Map<string, string>(
        config.CustomHeadersConfig.Items.map((h: Json) => [h.Header.toLowerCase(), h.Value]),
      );
      assert.equal(custom.get("cache-control"), "no-store");
      assert.match(custom.get("x-robots-tag") ?? "", /noindex/);
      assert.equal(custom.get("cross-origin-opener-policy"), "same-origin");
      // パスキーは Cognito のドメインで扱うので、管理画面には使わせない。
      for (const feature of ["publickey-credentials-get", "publickey-credentials-create"]) {
        assert.ok(custom.get("permissions-policy")?.includes(`${feature}=()`), feature);
      }
      const security = config.SecurityHeadersConfig;
      assert.equal(security.FrameOptions.FrameOption, "DENY");
      assert.equal(security.ContentTypeOptions.Override, true);
      assert.ok(security.StrictTransportSecurity.AccessControlMaxAgeSec >= 365 * 86_400);
    });
  });

  describe("Cognito", () => {
    it("ユーザーは管理者だけが作れ、パスキーかパスワードと TOTP で入る", () => {
      const [, pool] = one("AWS::Cognito::UserPool");
      const p = pool.Properties;
      assert.equal(p.UserPoolTier, "ESSENTIALS");
      assert.equal(p.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
      assert.deepEqual([...p.Policies.SignInPolicy.AllowedFirstAuthFactors].sort(), [
        "PASSWORD",
        "WEB_AUTHN",
      ]);
      assert.equal(p.MfaConfiguration, "ON");
      assert.deepEqual(p.EnabledMfas, ["SOFTWARE_TOKEN_MFA"]);
      assert.equal(p.WebAuthnFactorConfiguration, "MULTI_FACTOR_WITH_USER_VERIFICATION");
      assert.equal(p.WebAuthnUserVerification, "required");
      assert.equal(p.WebAuthnRelyingPartyID, RP_ID);
    });

    it("managed login は version 2 で、prefix domain に置く", () => {
      const [, domain] = one("AWS::Cognito::UserPoolDomain");
      assert.equal(domain.Properties.Domain, TEST_ADMIN.cognitoDomainPrefix);
      assert.equal(domain.Properties.ManagedLoginVersion, 2);
      const [clientId] = one("AWS::Cognito::UserPoolClient");
      const [, branding] = one("AWS::Cognito::ManagedLoginBranding");
      assert.deepEqual(refsIn(branding.Properties.ClientId), [clientId]);
    });

    it("所有者 1 人を、確認済みのメールアドレスで作る", () => {
      const [, user] = one("AWS::Cognito::UserPoolUser");
      assert.equal(user.Properties.Username, TEST_ADMIN.ownerEmail);
      assert.deepEqual(
        new Map(user.Properties.UserAttributes.map((a: Json) => [a.Name, a.Value])),
        new Map([
          ["email", TEST_ADMIN.ownerEmail],
          ["email_verified", "true"],
        ]),
      );
    });

    it("アプリクライアントはシークレットを持たず、認可コードを管理画面にだけ返す", () => {
      const [, client] = one("AWS::Cognito::UserPoolClient");
      const c = client.Properties;
      assert.equal(c.GenerateSecret, false);
      assert.deepEqual(c.AllowedOAuthFlows, ["code"]);
      assert.deepEqual([...c.AllowedOAuthScopes].sort(), ["email", "openid"]);
      assert.deepEqual(c.SupportedIdentityProviders, ["COGNITO"]);
      const adminDomain = `<${admin()[0]}.DomainName>`;
      // サインインの Lambda が Cognito に渡す戻り先と、一字でも違うと Cognito が拒む。
      assert.deepEqual(c.CallbackURLs.map(resolveString), [
        `https://${adminDomain}${ADMIN_PATHS.callback}`,
      ]);
      assert.deepEqual(c.LogoutURLs.map(resolveString), [
        `https://${adminDomain}${ADMIN_PATHS.signedOut}`,
      ]);
    });
  });

  describe("Lambda", () => {
    it("サインインの Lambda は、設定を SSM から読み、所有者のメールアドレスを知っている", () => {
      const vars = authFunction()[1].Properties.Environment.Variables;
      assert.equal(vars[ADMIN_FUNCTION_ENV.ownerEmail], TEST_ADMIN.ownerEmail);
      assert.equal(vars[ADMIN_FUNCTION_ENV.signingKeyParameterName], signingKeyParameterName(1));
      const [, param] = one("AWS::SSM::Parameter");
      assert.equal(param.Properties.Name, ADMIN_CONFIG_PARAMETER_NAME);
      const [poolId] = one("AWS::Cognito::UserPool");
      const [clientId] = one("AWS::Cognito::UserPoolClient");
      // Lambda が読む形（parseAdminConfig）で読めて、キーと値が取り違えていない。
      assert.deepEqual(parseAdminConfig(resolveString(param.Properties.Value)), {
        userPoolId: `<${poolId}>`,
        clientId: `<${clientId}>`,
        cognitoDomain: RP_ID,
        adminDomain: `<${admin()[0]}.DomainName>`,
      });
    });

    it("サインインの Lambda に許すのは、設定と鍵のパラメータを読むことだけ", () => {
      const statements = statementsOf(authFunction()[1]);
      const resources = statements
        .flatMap((s) => asArray<Json>(s.Resource))
        .map((r) => JSON.stringify(r));
      for (const s of statements) {
        assert.equal(s.Effect, "Allow");
        assert.deepEqual(asArray(s.Action), ["ssm:GetParameter"]);
      }
      assert.equal(resources.length, 2);
      assert.ok(resources.some((r) => r.includes(`:parameter${ADMIN_CONFIG_PARAMETER_NAME}"`)));
      assert.ok(resources.some((r) => r.includes(`:parameter${signingKeyParameterName(1)}"`)));
      for (const r of resources) assert.ok(!r.includes("*"), r);
    });

    it("ページの API の Lambda は、閲覧用のページに署名し、pages/ の一覧しか読めない", () => {
      const [, fn] = pagesFunction();
      const vars = fn.Properties.Environment.Variables;
      const [viewerId] = viewer();
      assert.deepEqual(vars[ADMIN_FUNCTION_ENV.viewerDomainName], {
        "Fn::GetAtt": [viewerId, "DomainName"],
      });
      const [contentBucketId] = Object.entries(resourcesOf("AWS::S3::Bucket")).find(([id]) =>
        id.startsWith("ContentBucket"),
      ) as [string, Json];
      assert.deepEqual(refsIn(vars[ADMIN_FUNCTION_ENV.bucketName]), [contentBucketId]);

      const statements = statementsOf(fn);
      const actions = statements.flatMap((s) => asArray<string>(s.Action)).sort();
      assert.deepEqual(actions, ["s3:ListBucket", "ssm:GetParameter"]);
      const list = statements.find((s) => asArray(s.Action).includes("s3:ListBucket"));
      assert.deepEqual(refsIn(list.Resource), [contentBucketId]);
      assert.deepEqual(list.Condition, { StringEquals: { "s3:prefix": PAGES_PREFIX } });
    });
  });

  describe("画面のファイル", () => {
    it("HTML はインラインのスクリプトを持たず、置いたファイルだけを読む", () => {
      const files = adminUiFiles();
      assert.deepEqual(Object.keys(files).sort(), ["app.css", "app.js", "index.html"]);
      const html = files["index.html"] ?? "";
      assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
      assert.doesNotMatch(html, /\son[a-z]+=/i);
      for (const [, ref] of html.matchAll(/(?:src|href)="\/([^"]*)"/g)) {
        if (`/${ref}` === ADMIN_PATHS.logout) continue;
        assert.ok(ref in files, `置いていないファイルを読む: ${ref}`);
      }
      assert.ok(html.includes(`href="${ADMIN_PATHS.logout}"`), "サインアウトの入口がない");
    });

    it("スクリプトは 1 ファイルにまとめ、ほかのファイルを読み込まない", () => {
      const script = adminUiFiles()["app.js"] ?? "";
      assert.ok(script.includes("/api/pages/"));
      assert.doesNotMatch(script, /^\s*import\s/m);
    });
  });

  it("サインインの入口の URL を出力する", () => {
    template.hasOutput(OUTPUT_KEYS.adminLoginUrl, {});
  });
});
