import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { buildSync } from "esbuild";
import { PAGES_PREFIX } from "../scripts/lib/page.js";
import type { AdminConfig } from "./admin/admin-config.js";
import { ADMIN_CONFIG_PARAMETER_NAME, ADMIN_FUNCTION_ENV, ADMIN_PATHS } from "./names.js";
import { nodeFunction, parameterArn } from "./node-function.js";
import { commonHeaders } from "./response-headers.js";

export interface AdminConsoleProps {
  /** ページを置くバケット。一覧のために pages/ の下だけを読む。 */
  readonly contentBucket: s3.IBucket;
  /** 閲覧用の Distribution。発行する URL は、このドメインのページを指す。 */
  readonly viewerDomainName: string;
  readonly keyGroup: cloudfront.IKeyGroup;
  readonly publicKeyId: string;
  readonly signingKeyParameterName: string;
  /** 管理画面に入れる、ただ 1 人のメールアドレス。リポジトリに書かず、deploy のときに渡す。 */
  readonly ownerEmail: string;
  /** managed login の prefix domain。リージョンの中で一意にする。 */
  readonly cognitoDomainPrefix: string;
}

const UI_DIR = new URL("./admin-ui/", import.meta.url);

/** 画面の静的ファイル。スクリプトは TypeScript から 1 ファイルにまとめ、インラインのスクリプトを使わない。 */
export function adminUiFiles(): Record<string, string> {
  const [script] = buildSync({
    entryPoints: [fileURLToPath(new URL("index.ts", UI_DIR))],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    legalComments: "none",
  }).outputFiles;
  return {
    "index.html": readFileSync(new URL("index.html", UI_DIR), "utf8"),
    "app.css": readFileSync(new URL("app.css", UI_DIR), "utf8"),
    // Stryker disable next-line OptionalChaining,StringLiteral: buildSync は write: false のとき、入口ごとに必ず 1 つ出力を返す
    "app.js": script?.text ?? "",
  };
}

/** 管理画面：ページの一覧と URL の発行だけを行う（ADR 13）。 */
export class AdminConsole extends Construct {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: AdminConsoleProps) {
    super(scope, id);
    const region = Stack.of(this).region;
    const cognitoDomain = `${props.cognitoDomainPrefix}.auth.${region}.amazoncognito.com`;

    const uiBucket = new s3.Bucket(this, "UiBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    new s3deploy.BucketDeployment(this, "Ui", {
      sources: Object.entries(adminUiFiles()).map(([name, text]) =>
        s3deploy.Source.data(name, text),
      ),
      destinationBucket: uiBucket,
    });

    const userPool = new cognito.UserPool(this, "UserPool", {
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      // 使う人はスタックで作る 1 人だけ。
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      signInPolicy: { allowedFirstAuthFactors: { password: true, passkey: true } },
      passkeyRelyingPartyId: cognitoDomain,
      passkeyUserVerification: cognito.PasskeyUserVerification.REQUIRED,
      // パスワードだけでは入れないようにする。user verification 付きのパスキーは、それだけで MFA を満たす（ADR 13）。
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: { minLength: 12 },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // aws-cdk-lib の UserPool に項目がないので、CloudFormation の値を直接書く。
    (userPool.node.defaultChild as cognito.CfnUserPool).addPropertyOverride(
      "WebAuthnFactorConfiguration",
      "MULTI_FACTOR_WITH_USER_VERIFICATION",
    );
    userPool.addDomain("LoginDomain", {
      cognitoDomain: { domainPrefix: props.cognitoDomainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    new cognito.CfnUserPoolUser(this, "Owner", {
      userPoolId: userPool.userPoolId,
      username: props.ownerEmail,
      userAttributes: [
        { name: "email", value: props.ownerEmail },
        { name: "email_verified", value: "true" },
      ],
      desiredDeliveryMediums: ["EMAIL"],
    });

    const authFunction = nodeFunction(this, "AuthFunction", {
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "html-share: 管理画面のサインインと署名付き Cookie",
      entry: fileURLToPath(new URL("./admin/auth-function/index.ts", import.meta.url)),
      environment: {
        [ADMIN_FUNCTION_ENV.configParameterName]: ADMIN_CONFIG_PARAMETER_NAME,
        [ADMIN_FUNCTION_ENV.ownerEmail]: props.ownerEmail,
        [ADMIN_FUNCTION_ENV.keyPairId]: props.publicKeyId,
        [ADMIN_FUNCTION_ENV.signingKeyParameterName]: props.signingKeyParameterName,
      },
    });
    authFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [
          parameterArn(this, ADMIN_CONFIG_PARAMETER_NAME),
          parameterArn(this, props.signingKeyParameterName),
        ],
      }),
    );

    const pagesFunction = nodeFunction(this, "PagesFunction", {
      // Stryker disable next-line StringLiteral: 表示の文言
      description: "html-share: 管理画面のページの一覧と URL の発行",
      entry: fileURLToPath(new URL("./admin/pages-function/index.ts", import.meta.url)),
      environment: {
        [ADMIN_FUNCTION_ENV.bucketName]: props.contentBucket.bucketName,
        [ADMIN_FUNCTION_ENV.viewerDomainName]: props.viewerDomainName,
        [ADMIN_FUNCTION_ENV.keyPairId]: props.publicKeyId,
        [ADMIN_FUNCTION_ENV.signingKeyParameterName]: props.signingKeyParameterName,
      },
    });
    // 管理画面からは、ページを書き換えも消しもさせない（ADR 13）。
    pagesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [props.contentBucket.bucketArn],
        conditions: { StringEquals: { "s3:prefix": PAGES_PREFIX } },
      }),
    );
    pagesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [parameterArn(this, props.signingKeyParameterName)],
      }),
    );

    // CloudFront の OAC からだけ呼べるようにする。CloudFront を通らない呼び出しは、IAM の署名がなく拒まれる。
    const lambdaOrigin = (fn: lambda.IFunction) =>
      origins.FunctionUrlOrigin.withOriginAccessControl(
        fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM }),
      );
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "Headers", {
      comment: "html-share admin: no inline script, no-store, noindex",
      ...commonHeaders([
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "connect-src 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
      ]),
    });
    const common = {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      responseHeadersPolicy,
    };
    // Function URL は、Host がオリジンのものでないと受け付けない。
    const toFunction = {
      ...common,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "html-share admin",
      defaultRootObject: "index.html",
      defaultBehavior: {
        ...common,
        origin: origins.S3BucketOrigin.withOriginAccessControl(uiBucket),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        trustedKeyGroups: [props.keyGroup],
      },
      additionalBehaviors: {
        // サインインの入口なので、署名を求めない。
        [ADMIN_PATHS.authPattern]: {
          ...toFunction,
          origin: lambdaOrigin(authFunction),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        },
        [ADMIN_PATHS.pagesApiPattern]: {
          ...toFunction,
          origin: lambdaOrigin(pagesFunction),
          // URL の発行に POST を使う。
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          trustedKeyGroups: [props.keyGroup],
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });
    const adminDomain = this.distribution.distributionDomainName;

    const client = userPool.addClient("Client", {
      // シークレットを持たず、PKCE で守る（ADR 13）。
      generateSecret: false,
      authFlows: { user: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [`https://${adminDomain}${ADMIN_PATHS.callback}`],
        logoutUrls: [`https://${adminDomain}${ADMIN_PATHS.signedOut}`],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.minutes(5),
      accessTokenValidity: Duration.minutes(5),
    });
    // CDK で作ったアプリクライアントには branding がなく、managed login が使えない。
    new cognito.CfnManagedLoginBranding(this, "LoginBranding", {
      userPoolId: userPool.userPoolId,
      clientId: client.userPoolClientId,
      useCognitoProvidedValues: true,
    });

    // アプリクライアントは Distribution のドメインに、Distribution は Lambda に依存する。
    // Lambda がアプリクライアントの ID を環境変数で受け取ると循環するので、実行時に SSM から読む（ADR 13）。
    new ssm.StringParameter(this, "Config", {
      parameterName: ADMIN_CONFIG_PARAMETER_NAME,
      stringValue: Stack.of(this).toJsonString({
        userPoolId: userPool.userPoolId,
        clientId: client.userPoolClientId,
        cognitoDomain,
        adminDomain,
      } satisfies AdminConfig),
    });
  }
}
