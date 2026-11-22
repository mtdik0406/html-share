// サインインの Lambda が外（トークンのエンドポイントと SSM）とやり取りする部分。fetch と SSM を差し替えて確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { createConfigLoader, createPostForm } from "../functions/admin-auth/auth-io.js";

describe("createPostForm", () => {
  function fakeFetch(response: Response) {
    const sent: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return response;
    };
    return { fetch, sent };
  }

  it("フォームの形で POST し、転送にはついて行かず、JSON を返す", async () => {
    const { fetch, sent } = fakeFetch(Response.json({ id_token: "t" }));
    const post = createPostForm(fetch);
    assert.deepEqual(await post("https://idp/oauth2/token", { a: "1", b: "x y" }), {
      id_token: "t",
    });
    const [req] = sent;
    assert.equal(req?.url, "https://idp/oauth2/token");
    assert.equal(req?.init?.method, "POST");
    assert.equal(req?.init?.redirect, "error");
    assert.equal(
      new Headers(req?.init?.headers).get("content-type"),
      "application/x-www-form-urlencoded",
    );
    assert.equal(String(req?.init?.body), "a=1&b=x+y");
  });

  it("失敗の応答でも JSON なら返す（id_token がなければ呼び出し側が拒む）", async () => {
    const { fetch } = fakeFetch(Response.json({ error: "invalid_grant" }, { status: 400 }));
    assert.deepEqual(await createPostForm(fetch)("https://idp/oauth2/token", {}), {
      error: "invalid_grant",
    });
  });

  it("JSON でない応答は undefined にする", async () => {
    const { fetch } = fakeFetch(new Response("<html>error</html>", { status: 502 }));
    assert.equal(await createPostForm(fetch)("https://idp/oauth2/token", {}), undefined);
  });
});

describe("createConfigLoader", () => {
  const CONFIG = {
    userPoolId: "p",
    clientId: "c",
    cognitoDomain: "x.auth.ap-northeast-1.amazoncognito.com",
    adminDomain: "d.cloudfront.net",
  };

  it("呼ぶたびに SSM から読み直す（作り直された Cognito の値を使い続けない）", async () => {
    const sent: object[] = [];
    let value = JSON.stringify(CONFIG);
    const ssm = {
      send: async (command: object) => {
        sent.push(command);
        return { Parameter: { Value: value } };
      },
    };
    const load = createConfigLoader(ssm, "/html-share/admin-config");
    assert.deepEqual(await load(), CONFIG);
    value = JSON.stringify({ ...CONFIG, clientId: "c2" });
    assert.equal((await load()).clientId, "c2");
    assert.equal(sent.length, 2);
    for (const command of sent) {
      assert.ok(command instanceof GetParameterCommand);
      assert.equal(command.input.Name, "/html-share/admin-config");
    }
  });
});
