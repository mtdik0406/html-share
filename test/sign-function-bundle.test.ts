// synth で作った署名の Lambda のバンドルを、そのまま読み込んで確かめる。
// バンドルの設定（入口・形式・banner）を誤ると、テンプレートは正しくても Lambda は動かない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AssetManifestArtifact } from "aws-cdk-lib/cx-api";
import { HtmlShareStack } from "../lib/html-share-stack.js";
import { SIGN_FUNCTION_ENV } from "../lib/names.js";
import { generateTestKeyPair } from "./helpers/keys.js";

const ENV: Record<string, string> = {
  [SIGN_FUNCTION_ENV.distributionDomainName]: "d111.cloudfront.net",
  [SIGN_FUNCTION_ENV.keyPairId]: "K2TESTKEYPAIRID",
  [SIGN_FUNCTION_ENV.parameterName]: "/html-share/test-key",
};

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

describe("署名の Lambda のバンドル", () => {
  let bundle: string;

  before(() => {
    const app = new App();
    const stack = new HtmlShareStack(app, "BundleStack", {
      publicKeyPem: generateTestKeyPair().publicKey,
      signingKeyGeneration: 1,
    });
    const template = Template.fromStack(stack);
    const [fn] = Object.values(template.findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Environment?.Variables?.[SIGN_FUNCTION_ENV.parameterName] !== undefined,
    );
    assert.ok(fn, "署名の Lambda がない");
    const [file, exportName] = fn.Properties.Handler.split(".");
    assert.equal(exportName, "handler");
    // コードの S3 のキーは「アセットのハッシュ.zip」。アセットの一覧から、synth で書き出した場所を引く。
    const hash = String(fn.Properties.Code.S3Key).replace(/\.zip$/, "");
    const manifest = app
      .synth()
      .artifacts.find((a): a is AssetManifestArtifact => a instanceof AssetManifestArtifact);
    assert.ok(manifest, "アセットの一覧がない");
    const source = manifest.contents.files?.[hash]?.source.path;
    assert.ok(source, "署名の Lambda のアセットがない");
    bundle = join(app.outdir, source, `${file}.mjs`);
  });

  it("読み込めて、正しくない要求を拒む", async () => {
    const { handler } = await importWith(bundle, ENV);
    assert.equal(typeof handler, "function");
    await assert.rejects(
      (handler as (e: unknown) => Promise<unknown>)({ slug: "../x", lifetimeMs: 60_000 }),
    );
  });

  it("AWS SDK をバンドルに含め、ランタイムに入っている SDK を読まない", () => {
    const code = readFileSync(bundle, "utf8");
    // ESM のバンドルで外に出したパッケージは、静的な import として残る。
    // SDK の中の require("@aws-sdk/signature-v4-crt") などは、入っていなければ使わない任意の読み込み。
    assert.doesNotMatch(code, /\bfrom\s*["']@aws-sdk\//);
  });

  it("環境変数が欠けていたら、読み込みで失敗する", async () => {
    for (const missing of Object.keys(ENV)) {
      const env = { ...ENV };
      delete env[missing];
      await assert.rejects(importWith(bundle, env));
    }
  });
});
