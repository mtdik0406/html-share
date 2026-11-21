import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { OUTPUT_KEYS, SIGN_FUNCTION_ENV, SIGNING_KEY_PARAMETER_NAME } from "./names.js";

// aws-cdk-lib に定数がまだないので、名前で指定する（ADR 9）。
const NODEJS_26 = new lambda.Runtime("nodejs26.x", lambda.RuntimeFamily.NODEJS);

export interface HtmlShareStackProps extends StackProps {
  /** RSA 公開鍵の PEM。CloudFront は BEGIN/END PUBLIC KEY の行を含む形しか受け付けない。 */
  readonly publicKeyPem: string;
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
    const publicKey = new cloudfront.PublicKey(this, "SigningPublicKey", {
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
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          // sandbox は <meta> では効かないので、ヘッダーで付ける。
          // allow-same-origin を付けないので、ページは不透明なオリジンになり、Cookie と localStorage に触れない。
          // 外部からは何も読ませない。読み込むたびに、閲覧者のアクセスが外部のサイトに伝わるため。
          // 素材は data URI でページに埋め込む前提なので、data: だけを許す。
          contentSecurityPolicy: [
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
          ].join("; "),
          override: true,
        },
        // 既定の strict-origin-when-cross-origin でもクエリは落ちるが、オリジンも渡す理由がない。
        // 署名はクエリにあるので、ここが緩むと URL を持たない相手に閲覧権を渡すことになる。
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        // *.cloudfront.net は自分のドメインではないので、includeSubdomains と preload は付けない。
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          // 期限が切れた URL のページを、ブラウザのキャッシュや戻るボタンで見せないため。
          // CloudFront 自身のキャッシュは cachePolicy で止めている。これは閲覧者側だけに効く。
          { header: "Cache-Control", value: "no-store", override: true },
          { header: "X-Robots-Tag", value: "noindex, nofollow", override: true },
          // ページが開いたウィンドウ（や、ページを開いたウィンドウ）から、互いを操作させない。
          { header: "Cross-Origin-Opener-Policy", value: "same-origin", override: true },
          // sandbox でも、端末の機能を使う許可を閲覧者に求めることはできるので、ヘッダーで止める。
          {
            header: "Permissions-Policy",
            value: [
              "camera=()",
              "microphone=()",
              "geolocation=()",
              "display-capture=()",
              "usb=()",
              "serial=()",
              "hid=()",
              "bluetooth=()",
              "payment=()",
            ].join(", "),
            override: true,
          },
        ],
      },
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

    const signFunction = new nodejs.NodejsFunction(this, "SignFunction", {
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "html-share: SSM の秘密鍵でページの署名付き URL を作る",
      entry: fileURLToPath(new URL("./sign-function/index.ts", import.meta.url)),
      runtime: NODEJS_26,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        [SIGN_FUNCTION_ENV.distributionDomainName]: distribution.distributionDomainName,
        [SIGN_FUNCTION_ENV.keyPairId]: publicKey.publicKeyId,
        [SIGN_FUNCTION_ENV.parameterName]: SIGNING_KEY_PARAMETER_NAME,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        // ランタイムに入っている SDK を使わず、手元と同じ版をバンドルに含める（ADR 9）。
        // Stryker disable next-line ArrayDeclaration: 存在しない名前を外に出しても、バンドルは同じ
        externalModules: [],
        // ESM のバンドルの中で、CommonJS の依存が require を使えるようにする。
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      logGroup: new logs.LogGroup(this, "SignFunctionLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    // grantRead は GetParameters や GetParameterHistory も許すので、使う操作だけを書く。
    // aws/ssm で暗号化した値は、kms:Decrypt を足さなくても復号できる（ADR 9）。
    signFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          this.formatArn({
            service: "ssm",
            resource: "parameter",
            resourceName: SIGNING_KEY_PARAMETER_NAME.slice(1),
          }),
        ],
      }),
    );

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
