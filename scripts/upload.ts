import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { runCli } from "./lib/cli.js";
import { assertSlug, pageKey } from "./lib/page.js";
import { readStackOutputs } from "./lib/stack-outputs.js";

await runCli(async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { overwrite: { type: "boolean", default: false } },
  });

  // 余分な引数を黙って捨てない。`--` の後ろのオプションは位置引数になり、無視されてしまうため。
  if (positionals.length !== 2) {
    throw new Error("使い方: pnpm run upload <HTML ファイル> <slug> [--overwrite]");
  }
  const [file, slug] = positionals as [string, string];
  assertSlug(slug);
  // AWS に問い合わせる前に、手元の入力の誤りを見つける。
  const body = await readFile(file);

  const { bucketName } = await readStackOutputs();
  const key = pageKey(slug);

  try {
    await new S3Client({}).send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: body,
        // 付けないと application/octet-stream になり、ブラウザが表示せずにダウンロードする。
        // charset を付けないと、日本語が化けることがある。
        ContentType: "text/html; charset=utf-8",
        // キーがすでにあると S3 は 412 を返す。配布済みの URL の中身が、知らないうちに差し替わるのを防ぐ。
        IfNoneMatch: values.overwrite ? undefined : "*",
      }),
    );
  } catch (err) {
    if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 412) {
      throw new Error(
        `${slug} はすでにあります。配布済みの URL の中身も変わりますが、上書きするなら --overwrite を付けてください`,
      );
    }
    throw err;
  }

  console.log(`uploaded: s3://${bucketName}/${key}`);
  console.log(`次に署名付き URL を作る: pnpm run sign ${slug}`);
});
