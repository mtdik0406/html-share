import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";
import { OUTPUT_KEYS } from "./names.js";

export interface HtmlShareStackProps extends StackProps {
  /** RSA 公開鍵の PEM。CloudFront は BEGIN/END PUBLIC KEY の行を含む形しか受け付けない。 */
  readonly publicKeyPem: string;
}

/**
 *   閲覧者 ──(署名付き URL)──▶ CloudFront ──(OAC)──▶ S3（非公開）
 */
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

    new CfnOutput(this, OUTPUT_KEYS.bucketName, { value: bucket.bucketName });
    new CfnOutput(this, OUTPUT_KEYS.distributionDomainName, {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, OUTPUT_KEYS.publicKeyId, {
      value: publicKey.publicKeyId,
      description: "署名付き URL の Key-Pair-Id に入れる値",
    });
  }
}
