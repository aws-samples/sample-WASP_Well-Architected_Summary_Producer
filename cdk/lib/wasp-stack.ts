import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { FrontendConstruct } from './constructs/frontend';
import { AuthConstruct } from './constructs/auth';
import { ComputeConstruct } from './constructs/compute';
import { ApiConstruct } from './constructs/api';
import { DatabaseConstruct } from './constructs/database';

export interface WaspStackProps extends cdk.StackProps {
  adminEmail: string;
}

export class WaspStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WaspStackProps) {
    super(scope, id, props);

    // Database (Amazon DynamoDB + AWS KMS)
    const database = new DatabaseConstruct(this, 'Database');

    // Auth (Cognito User Pool + Hosted UI)
    const auth = new AuthConstruct(this, 'Auth', {
      adminEmail: props.adminEmail,
    });

    // Compute (Lambda functions)
    const compute = new ComputeConstruct(this, 'Compute', {
      table: database.table,
      kmsKey: database.kmsKey,
    });

    // API (API Gateway + Cognito authorizer)
    const api = new ApiConstruct(this, 'Api', {
      userPool: auth.userPool,
      lambdaFunction: compute.apiFunction,
      asyncFunction: compute.asyncFunction,
    });

    // Frontend (S3 + CloudFront)
    const frontend = new FrontendConstruct(this, 'Frontend', {
      apiUrl: api.apiUrl,
      userPoolId: auth.userPool.userPoolId,
      userPoolClientId: auth.userPoolClient.userPoolClientId,
      cognitoDomain: auth.domainPrefix,
    });

    // Update Cognito callback URLs with the CloudFront domain
    const cfnClient = auth.userPoolClient.node.defaultChild as cdk.aws_cognito.CfnUserPoolClient;
    const cloudFrontUrl = `https://${frontend.distribution.distributionDomainName}`;
    cfnClient.addPropertyOverride('CallbackURLs', [cloudFrontUrl + '/']);
    cfnClient.addPropertyOverride('LogoutURLs', [cloudFrontUrl + '/']);

    // Set CORS origin on Lambda functions (restricted to CloudFront domain only)
    compute.apiFunction.addEnvironment('CORS_ORIGIN', cloudFrontUrl);
    compute.asyncFunction.addEnvironment('CORS_ORIGIN', cloudFrontUrl);

    // Add CORS headers to API Gateway error responses (401, 403, 5xx)
    // Restricted to CloudFront domain — not wildcard
    const corsOriginHeader = `'${cloudFrontUrl}'`;
    api.restApi.addGatewayResponse('Unauthorized', {
      type: cdk.aws_apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });
    api.restApi.addGatewayResponse('AccessDenied', {
      type: cdk.aws_apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });
    api.restApi.addGatewayResponse('Default5xx', {
      type: cdk.aws_apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
    });

    // cdk-nag suppressions for findings that are acceptable in this sample
    NagSuppressions.addStackSuppressions(this, [
      { id: 'AwsSolutions-L1', reason: 'Python 3.12 is the latest stable runtime supported by CDK bundling. The BucketDeployment Lambda uses a CDK-managed runtime that cannot be overridden.' },
      { id: 'AwsSolutions-IAM4', reason: 'AWSLambdaBasicExecutionRole is required for CloudWatch Logs. Custom log policies add complexity without security benefit for a sample.' },
      { id: 'AwsSolutions-IAM5', reason: 'Wildcard resources are used for: (1) Bedrock foundation models which cannot be known in advance, (2) WAFR workloads scoped to the account, (3) S3 bucket deploy operations managed by CDK, (4) KMS operations required by DynamoDB grant methods.' },
      { id: 'AwsSolutions-COG8', reason: 'Cognito Plus tier is set via CfnResource override (UserPoolTier: PLUS). CDK-nag cannot detect escape-hatch properties.' },
      { id: 'AwsSolutions-CFR1', reason: 'Geo restrictions not required for a sample. Users can add restrictions for their specific deployment region.' },
      { id: 'AwsSolutions-CFR2', reason: 'Documented as a recommendation for implementation.' },
      { id: 'AwsSolutions-CFR4', reason: 'TLS 1.2 minimum is enforced via SecurityPolicyProtocol.TLS_V1_2_2021. CDK-nag flags this because no custom viewer certificate is used (using default CloudFront cert).' },
      { id: 'AwsSolutions-APIG2', reason: 'Request validation is handled by the Lambda function and Cognito authorizer. API Gateway proxy integration passes all requests to Flask which validates input.' },
      { id: 'AwsSolutions-APIG3', reason: 'Documented as a recommendation for implementation.' },
    ]);

    // Outputs — only what users need
    new cdk.CfnOutput(this, 'AppUrl', {
      value: cloudFrontUrl,
      description: 'WASP application URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID (for adding users)',
    });
  }
}
