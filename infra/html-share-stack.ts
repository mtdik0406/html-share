import { fileURLToPath } from "node:url";
import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import {
  ADMIN_PATHS,
  OUTPUT_KEYS,
  SIGN_FUNCTION_ENV,
  signingKeyParameterName,
} from "../core/names.js";
import { AdminConsole, type AdminConsoleProps } from "./admin-console.js";
import { nodeFunction, parameterArn } from "./node-function.js";
import { commonHeaders } from "./response-headers.js";

export interface HtmlShareStackProps extends StackProps {
  /** RSA 公開鍵の PEM。CloudFront は BEGIN/END PUBLIC KEY の行を含む形しか受け付けない。 */
  readonly publicKeyPem: string;
  /** 鍵を作り直すたびに 1 増やす。 */
  readonly signingKeyGeneration: number;
  readonly admin: Pick<AdminConsoleProps, "ownerEmail" | "cognitoDomainPrefix">;
}

export class HtmlShareStack extends Stack {
  constructor(scope: Construct, id: string, props: HtmlShareStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "ContentBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // autoDeleteObjects がないと、空でないバケットは destroy で消せない。削除用の Lambda とロールが追加で作られる。
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Distribution は鍵を KeyGroup 単位で信頼する。鍵を入れ替えるときは、新旧を同じグループに並べて移行する。
    // CloudFront の公開鍵は、作ったあと中身を変えられない。鍵を作り直すときは世代を上げ、別の公開鍵として作らせる。
    // 1 世代目は、デプロイ済みの公開鍵を作り直さないよう、世代を足す前と同じ ID にする。
    const generation = props.signingKeyGeneration;
    // 世代が正しくなければ、ここで失敗する。
    const parameterName = signingKeyParameterName(generation);
    const publicKeyId = generation === 1 ? "SigningPublicKey" : `SigningPublicKeyGen${generation}`;
    const publicKey = new cloudfront.PublicKey(this, publicKeyId, {
      encodedKey: props.publicKeyPem,
      comment: "html-share signed URL verification key",
    });
    const keyGroup = new cloudfront.KeyGroup(this, "SigningKeyGroup", {
      items: [publicKey],
    });

    // ページは自分以外が書いた HTML（AI の出力）なので、外へ持ち出す手段をできるだけ減らす。
    // ゼロにはできない。ページが自分自身を外部の URL へ移動させることは、ヘッダーでは止められない。
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "ViewerHeaders", {
      comment: "html-share viewer: sandbox, no-store, noindex",
      // sandbox は <meta> では効かないので、ヘッダーで付ける。
      // allow-same-origin を付けないので、ページは不透明なオリジンになり、Cookie と localStorage に触れない。
      // 外部からは何も読ませない。読み込むたびに、閲覧者のアクセスが外部のサイトに伝わるため。
      // 素材は data URI でページに埋め込む前提なので、data: だけを許す。
      ...commonHeaders([
        "default-src 'none'",
        "script-src 'unsafe-inline' data:",
        "style-src 'unsafe-inline' data:",
        "img-src data:",
        "font-src data:",
        "media-src data:",
        "connect-src 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "sandbox allow-scripts",
      ]),
    });

    const distribution = new cloudfront.Distribution(this, "ContentDistribution", {
      comment: "html-share viewer",
      defaultBehavior: {
        // CDK がバケットポリシーに「この Distribution からの s3:GetObject だけを許可」を自動で足す。
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        // 上書きアップロードをすぐ反映させるため。
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // 名前は "trusted" だが、指定すると署名のない要求はすべて拒否される（任意ではなく必須）。
        trustedKeyGroups: [keyGroup],
        responseHeadersPolicy,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    const signFunction = nodeFunction(this, "SignFunction", {
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "html-share: SSM の秘密鍵でページの署名付き URL を作る",
      entry: fileURLToPath(new URL("../functions/sign/index.ts", import.meta.url)),
      environment: {
        [SIGN_FUNCTION_ENV.distributionDomainName]: distribution.distributionDomainName,
        [SIGN_FUNCTION_ENV.keyPairId]: publicKey.publicKeyId,
        [SIGN_FUNCTION_ENV.parameterName]: parameterName,
      },
    });
    // grantRead は GetParameters や GetParameterHistory も許すので、使う操作だけを書く。
    // aws/ssm で暗号化した値は、kms:Decrypt を足さなくても復号できる（ADR 9）。
    signFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [parameterArn(this, parameterName)],
      }),
    );

    const adminConsole = new AdminConsole(this, "Admin", {
      ...props.admin,
      contentBucket: bucket,
      viewerDomainName: distribution.distributionDomainName,
      keyGroup,
      publicKeyId: publicKey.publicKeyId,
      signingKeyParameterName: parameterName,
    });

    new CfnOutput(this, OUTPUT_KEYS.adminLoginUrl, {
      value: `https://${adminConsole.distribution.distributionDomainName}${ADMIN_PATHS.login}`,
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "管理画面のサインインの入口",
    });
    new CfnOutput(this, OUTPUT_KEYS.bucketName, { value: bucket.bucketName });
    new CfnOutput(this, OUTPUT_KEYS.distributionDomainName, {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, OUTPUT_KEYS.publicKeyId, {
      value: publicKey.publicKeyId,
      description: "署名付き URL の Key-Pair-Id に入れる値",
    });
    new CfnOutput(this, OUTPUT_KEYS.signFunctionName, {
      value: signFunction.functionName,
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "pnpm run sign が呼ぶ署名の Lambda",
    });
  }
}
