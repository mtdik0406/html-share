import { Duration } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";

/**
 * 閲覧用と管理画面の応答ヘッダー。CSP だけを分け、ほかは同じにする。
 * 管理画面の Cookie も閲覧用の URL も、漏れれば閲覧権を渡すことになるため。
 */
export function commonHeaders(
  csp: readonly string[],
): Pick<
  cloudfront.ResponseHeadersPolicyProps,
  "securityHeadersBehavior" | "customHeadersBehavior"
> {
  return {
    securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy: csp.join("; "), override: true },
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
        // 管理画面のパスキーは Cognito のドメインで扱うので、publickey-credentials も止めたままでよい。
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
            "midi=()",
            "accelerometer=()",
            "gyroscope=()",
            "magnetometer=()",
            "ambient-light-sensor=()",
            "local-fonts=()",
            "window-management=()",
            "screen-wake-lock=()",
            "idle-detection=()",
            "xr-spatial-tracking=()",
            "publickey-credentials-get=()",
            "publickey-credentials-create=()",
            // 署名付き URL や端末の情報を、ほかのアプリや識別子の仕組みへ渡させない。
            "web-share=()",
            "identity-credentials-get=()",
            "otp-credentials=()",
            "browsing-topics=()",
          ].join(", "),
          override: true,
        },
      ],
    },
  };
}
