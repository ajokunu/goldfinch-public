import { CfnOutput, Duration, Stack, StackProps, Tags } from 'aws-cdk-lib';
import {
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvConfig } from './config';

export interface WebStackProps extends StackProps {
  readonly config: EnvConfig;
}

/**
 * Origins the RN Web SPA must be allowed to reach from the browser (XHR/fetch
 * for the API and the Cognito hosted-UI token/refresh endpoints). Kept here as
 * named constants so the CSP connect-src below documents exactly what the SPA
 * talks to. HTTPS scheme is explicit so the policy never permits cleartext.
 */
const API_ORIGIN = 'https://rya92vtrt3.execute-api.us-east-1.amazonaws.com';
const COGNITO_ORIGIN = 'https://goldfinch-login.auth.us-east-1.amazoncognito.com';

/**
 * Content-Security-Policy scoped for an Expo RN-Web single-page app.
 *
 * default-src 'self' locks every resource class to the CloudFront origin unless
 * widened below. Expo's web runtime injects inline <style> blocks (react-native
 * StyleSheet) and inline styles, so style-src needs 'unsafe-inline'. connect-src
 * is widened to exactly the API and Cognito origins the SPA calls (everything
 * else stays same-origin). img/font allow data:/blob: for inlined assets and
 * the OAuth code-verifier blobs. frame-ancestors 'none' is the CSP-level
 * clickjacking defense paired with the X-Frame-Options DENY header below.
 *
 * script-src is intentionally 'self' only here, which a Hermes/Metro web bundle
 * generally satisfies (no eval at runtime) — but an Expo web build CAN ship
 * inline bootstrap scripts or rely on eval in dev tooling. Rather than risk a
 * hard break of the live SPA, this CSP is shipped in Content-Security-Policy-
 * Report-Only first (see customHeadersBehavior below): browsers report
 * violations without blocking, so we can confirm the policy is clean before
 * promoting it to the enforcing Content-Security-Policy header.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_ORIGIN} ${COGNITO_ORIGIN}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/**
 * WebStack: private S3 web-assets bucket + CloudFront distribution with
 * Origin Access Control for the RN Web build. No public bucket access; the
 * bucket policy grants s3:GetObject only to the CloudFront service principal
 * scoped to this distribution (handled by S3BucketOrigin.withOriginAccessControl).
 */
export class WebStack extends Stack {
  public readonly webBucket: Bucket;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { config } = props;
    Tags.of(this).add('Component', 'web');

    this.webBucket = new Bucket(this, 'WebBucket', {
      bucketName: `goldfinch-web-${this.account}-${this.region}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: config.removalPolicy,
    });

    const spaRewrite = new CloudFrontFunction(this, 'SpaRewriteFn', {
      functionName: `goldfinch-spa-rewrite-${config.env}`,
      comment: 'Rewrites extensionless paths to /index.html for SPA deep links',
      code: FunctionCode.fromFile({
        filePath: path.join(__dirname, '..', 'cloudfront', 'spa-rewrite.js'),
      }),
    });

    // Security response headers on every CloudFront response. HSTS,
    // X-Frame-Options, X-Content-Type-Options and Referrer-Policy are
    // safe-to-enforce now (they do not affect how the SPA renders). The CSP is
    // shipped Report-Only first (customHeadersBehavior) so we can confirm the
    // policy does not break the Expo web bundle before promoting it to the
    // enforcing Content-Security-Policy header.
    const securityHeaders = new ResponseHeadersPolicy(this, 'WebSecurityHeaders', {
      responseHeadersPolicyName: `goldfinch-web-security-${config.env}`,
      comment: 'Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP report-only) for the GoldFinch SPA',
      securityHeadersBehavior: {
        strictTransportSecurity: {
          // >= 1 year, applies to subdomains; preload left off until a custom
          // apex domain (decision D3) is live to avoid pinning the CloudFront
          // default domain into browser preload lists.
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            // Report-Only ships the CSP as observe-don't-block so a strict
            // policy cannot break the live SPA; promote to the enforcing
            // Content-Security-Policy header once reports come back clean.
            header: 'Content-Security-Policy-Report-Only',
            value: CONTENT_SECURITY_POLICY,
            override: true,
          },
        ],
      },
    });

    this.distribution = new Distribution(this, 'WebDistribution', {
      comment: `GoldFinch web (${config.env})`,
      defaultRootObject: 'index.html',
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: securityHeaders,
        functionAssociations: [
          { function: spaRewrite, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      // Belt-and-suspenders alongside the rewrite function: a private bucket
      // behind OAC returns 403 (not 404) for missing keys.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
      ],
    });

    new CfnOutput(this, 'WebBucketName', { value: this.webBucket.bucketName });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason:
          'Server access logging for a two-user private SPA bucket adds cost with no review value; CloudFront serves all traffic and the bucket allows only the OAC principal.',
      },
      {
        id: 'AwsSolutions-CFR1',
        reason: 'Geo restrictions are unnecessary for a private two-user application behind Cognito.',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason:
          'WAF carries a monthly base charge that violates the cost model; the app is JWT-gated and the distribution serves only static assets.',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'CloudFront access logging is disabled for cost discipline at two-user traffic.',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason:
          'The distribution uses the default CloudFront certificate until the custom domain (decision D3) is attached; the default certificate does not support configuring the minimum TLS protocol version.',
      },
      {
        id: 'AwsSolutions-CFR7',
        reason: 'Origin Access Control IS configured via S3BucketOrigin.withOriginAccessControl.',
      },
    ]);
  }
}
