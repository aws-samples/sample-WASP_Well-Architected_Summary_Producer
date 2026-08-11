import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface ApiConstructProps {
  userPool: cognito.UserPool;
  lambdaFunction: lambda.Function;
  asyncFunction: lambda.Function;
  cloudFrontDomainName?: string;
}

export class ApiConstruct extends Construct {
  public readonly apiUrl: string;
  public readonly restApi: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    // API Gateway access log group (KMS encrypted)
    const logsKey = new cdk.aws_kms.Key(this, 'LogsKey', {
      description: 'WASP API Gateway log encryption key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    logsKey.addToResourcePolicy(new cdk.aws_iam.PolicyStatement({
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
      ],
      principals: [new cdk.aws_iam.ServicePrincipal(`logs.${cdk.Aws.REGION}.amazonaws.com`)],
      resources: ['*'],
    }));

    const apiLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryptionKey: logsKey,
    });

    // REST API
    const api = new apigateway.RestApi(this, 'WaspApi', {
      restApiName: 'wasp-api',
      description: 'WASP Well-Architected Summary Producer API',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
      identitySource: 'method.request.header.Authorization',
    });

    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Lambda integration for sync requests
    const syncIntegration = new apigateway.LambdaIntegration(props.lambdaFunction);

    // Proxy all /api/* requests to Lambda
    const apiResource = api.root.addResource('api');
    const proxyResource = apiResource.addProxy({
      defaultIntegration: syncIntegration,
      defaultMethodOptions: authOptions,
      anyMethod: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
        ],
        maxAge: cdk.Duration.hours(1),
      },
    });

    // Add all HTTP methods with auth, but NOT OPTIONS (handled by CORS preflight above)
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      proxyResource.addMethod(method, syncIntegration, authOptions);
    }

    this.restApi = api;
    this.apiUrl = api.url;
  }
}
