import { Match, Template } from 'aws-cdk-lib/assertions';
import { WebStack } from '../lib/web-stack';
import { TEST_ENV, testApp, testConfig } from './helpers';

function synthWebStack(): Template {
  const app = testApp();
  const stack = new WebStack(app, 'GoldFinch-Web-test', {
    env: TEST_ENV,
    config: testConfig(app),
  });
  return Template.fromStack(stack);
}

describe('WebStack', () => {
  const template = synthWebStack();

  test('web bucket is fully private with SSE-S3 and TLS enforced', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'goldfinch-web-111111111111-us-east-1',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  test('distribution uses OAC (no legacy OAI, no public origin)', () => {
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: Match.objectLike({
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4',
      }),
    });
  });

  test('SPA behavior: default root object, HTTPS redirect, 403/404 to index.html', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'redirect-to-https',
          FunctionAssociations: Match.arrayWith([
            Match.objectLike({ EventType: 'viewer-request' }),
          ]),
        }),
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
  });

  test('a viewer-request CloudFront Function performs the SPA rewrite', () => {
    template.resourceCountIs('AWS::CloudFront::Function', 1);
  });

  test('a ResponseHeadersPolicy ships HSTS, X-Frame, nosniff, Referrer-Policy and report-only CSP', () => {
    // Exactly one security headers policy, with the safe-to-enforce headers
    // plus the CSP shipped Report-Only first.
    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({
            // >= 1 year in seconds, includeSubDomains on.
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
            Override: true,
          }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ReferrerPolicy: {
            ReferrerPolicy: 'strict-origin-when-cross-origin',
            Override: true,
          },
        }),
        CustomHeadersConfig: Match.objectLike({
          Items: Match.arrayWith([
            Match.objectLike({
              Header: 'Content-Security-Policy-Report-Only',
              Override: true,
              Value: Match.stringLikeRegexp(
                // default-src self plus the API + Cognito connect-src origins
                // the SPA must reach, and frame-ancestors none.
                "default-src 'self'.*rya92vtrt3\\.execute-api\\.us-east-1\\.amazonaws\\.com.*goldfinch-login\\.auth\\.us-east-1\\.amazoncognito\\.com",
              ),
            }),
          ]),
        }),
      }),
    });
  });

  test('the policy is attached to the default cache behavior', () => {
    const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
    const policyLogicalId = Object.keys(policies)[0];
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ResponseHeadersPolicyId: { Ref: policyLogicalId },
        }),
      }),
    });
  });

  test('snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
