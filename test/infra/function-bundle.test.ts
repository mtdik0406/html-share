// synth で作った Lambda のバンドルを、そのまま読み込んで確かめる。
// バンドルの設定（入口・形式・banner）を誤ると、テンプレートは正しくても Lambda は動かない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AssetManifestArtifact } from "aws-cdk-lib/cx-api";
import { ADMIN_FUNCTION_ENV, SIGN_FUNCTION_ENV } from "../../core/names.js";
import { HtmlShareStack } from "../../infra/html-share-stack.js";
import { generateTestKeyPair } from "../helpers/keys.js";
import { TEST_ADMIN } from "../helpers/stack.js";

// 同じファイルを読み直すと、モジュールのキャッシュが返る。クエリを変えて、読み込みのたびに入口を実行させる。
let loads = 0;
async function importWith(
  bundle: string,
  env: Record<string, string>,
): Promise<Record<string, unknown>> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    loads += 1;
    return await import(`${pathToFileURL(bundle).href}?load=${loads}`);
  } finally {
    for (const name of Object.keys(env)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

const SIGN_ENV: Record<string, string> = {
  [SIGN_FUNCTION_ENV.distributionDomainName]: "d111.cloudfront.net",
  [SIGN_FUNCTION_ENV.keyPairId]: "K2TESTKEYPAIRID",
  [SIGN_FUNCTION_ENV.parameterName]: "/html-share/test-key",
};
const urlRequest = (rawPath: string) => ({ rawPath, requestContext: { http: { method: "GET" } } });

// どの Lambda も、外（SSM・S3・Cognito）を呼ばずに答えられる要求で、入口が動くことを確かめる。
const FUNCTIONS = [
  {
    name: "署名の Lambda",
    idPrefix: "SignFunction",
    env: SIGN_ENV,
    check: async (handler: (e: unknown) => Promise<unknown>) => {
      await assert.rejects(handler({ slug: "../x", lifetimeMs: 60_000 }));
    },
  },
  {
    name: "サインインの Lambda",
    idPrefix: "AdminAuthFunction",
    env: {
      [ADMIN_FUNCTION_ENV.configParameterName]: "/html-share/test-config",
      [ADMIN_FUNCTION_ENV.ownerEmail]: "owner@example.com",
      [ADMIN_FUNCTION_ENV.keyPairId]: "K2TESTKEYPAIRID",
      [ADMIN_FUNCTION_ENV.signingKeyParameterName]: "/html-share/test-key",
      AWS_REGION: "ap-northeast-1",
    },
    check: async (handler: (e: unknown) => Promise<unknown>) => {
      assert.deepEqual(await handler(urlRequest("/auth/unknown")), { statusCode: 404 });
    },
  },
  {
    name: "ページの API の Lambda",
    idPrefix: "AdminPagesFunction",
    env: {
      [ADMIN_FUNCTION_ENV.bucketName]: "test-bucket",
      [ADMIN_FUNCTION_ENV.viewerDomainName]: "d111.cloudfront.net",
      [ADMIN_FUNCTION_ENV.keyPairId]: "K2TESTKEYPAIRID",
      [ADMIN_FUNCTION_ENV.signingKeyParameterName]: "/html-share/test-key",
    },
    check: async (handler: (e: unknown) => Promise<unknown>) => {
      const res = (await handler(urlRequest("/api/unknown"))) as { statusCode: number };
      assert.equal(res.statusCode, 404);
    },
  },
];

describe("Lambda のバンドル", () => {
  const bundles = new Map<string, string>();

  before(() => {
    const app = new App();
    const stack = new HtmlShareStack(app, "BundleStack", {
      publicKeyPem: generateTestKeyPair().publicKey,
      signingKeyGeneration: 1,
      admin: TEST_ADMIN,
    });
    const template = Template.fromStack(stack);
    const manifest = app
      .synth()
      .artifacts.find((a): a is AssetManifestArtifact => a instanceof AssetManifestArtifact);
    assert.ok(manifest, "アセットの一覧がない");
    for (const { idPrefix } of FUNCTIONS) {
      const found = Object.entries(template.findResources("AWS::Lambda::Function")).filter(([id]) =>
        id.startsWith(idPrefix),
      );
      assert.equal(found.length, 1, `${idPrefix} が 1 つでない`);
      const [, fn] = found[0] as [string, Record<string, Record<string, unknown>>];
      const [file, exportName] = String(fn.Properties?.Handler).split(".");
      assert.equal(exportName, "handler");
      // コードの S3 のキーは「アセットのハッシュ.zip」。アセットの一覧から、synth で書き出した場所を引く。
      const code = fn.Properties?.Code as { S3Key: string };
      const hash = code.S3Key.replace(/\.zip$/, "");
      const source: string | undefined = manifest.contents.files?.[hash]?.source.path;
      assert.ok(source, `${idPrefix} のアセットがない`);
      bundles.set(idPrefix, join(app.outdir, source, `${file}.mjs`));
    }
  });

  for (const { name, idPrefix, env, check } of FUNCTIONS) {
    describe(name, () => {
      const bundle = () => bundles.get(idPrefix) as string;

      it("読み込めて、外を呼ばずに答えられる要求に答える", async () => {
        const { handler } = await importWith(bundle(), env);
        assert.equal(typeof handler, "function");
        await check(handler as (e: unknown) => Promise<unknown>);
      });

      it("AWS SDK をバンドルに含め、ランタイムに入っている SDK を読まない", () => {
        const code = readFileSync(bundle(), "utf8");
        // ESM のバンドルで外に出したパッケージは、静的な import として残る。
        // SDK の中の require("@aws-sdk/signature-v4-crt") などは、入っていなければ使わない任意の読み込み。
        assert.doesNotMatch(code, /\bfrom\s*["']@aws-sdk\//);
      });

      it("環境変数が欠けていたら、読み込みで失敗する", async () => {
        for (const missing of Object.keys(env)) {
          const partial: Record<string, string> = { ...env };
          delete partial[missing];
          // AWS_REGION はランタイムが必ず渡すので、テストを流す環境の値が残っていても構わない。
          if (missing === "AWS_REGION") continue;
          await assert.rejects(importWith(bundle(), partial), missing);
        }
      });
    });
  }
});
