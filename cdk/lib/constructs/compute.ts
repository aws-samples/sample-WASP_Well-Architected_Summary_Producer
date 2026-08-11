import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { Construct } from 'constructs';

export interface ComputeConstructProps {
  table: dynamodb.Table;
  kmsKey: kms.Key;
}

export class ComputeConstruct extends Construct {
  public readonly apiFunction: lambda.Function;
  public readonly asyncFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    // Shared IAM policy statements
    const wafrReadPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'wellarchitected:ListWorkloads',
        'wellarchitected:GetWorkload',
        'wellarchitected:GetLensReview',
        'wellarchitected:ListAnswers',
        'wellarchitected:GetAnswer',
        'wellarchitected:ListLensReviewImprovements',
        'wellarchitected:ListMilestones',
      ],
      resources: ['*'],
    });

    const wafrWritePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'wellarchitected:CreateMilestone',
        'wellarchitected:UpdateAnswer',
      ],
      resources: [`arn:aws:wellarchitected:*:${cdk.Aws.ACCOUNT_ID}:workload/*`],
    });

    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:ListFoundationModels',
      ],
      resources: ['*'],
    });

    const bedrockRuntimePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock-runtime:Converse',
        'bedrock-runtime:InvokeModel',
        'bedrock:InvokeModel',
      ],
      resources: [
        `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`,
      ],
    });

    const stsPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:GetCallerIdentity'],
      resources: ['*'],
    });

    // Dead letter queue for failed Lambda invocations
    const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    // API Lambda — handles synchronous requests (< 29s)
    this.apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../..', 'backend'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -r *.py prompts/ /asset-output/',
          ],

        },
      }),
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      reservedConcurrentExecutions: 10,
      deadLetterQueue: dlq,
      environment: {
        WASP_TABLE_NAME: props.table.tableName,
        POWERTOOLS_SERVICE_NAME: 'wasp-api',
      },
      architecture: lambda.Architecture.ARM_64,
    });

    // Async Lambda — handles long-running operations (summaries, recommend positions)
    this.asyncFunction = new lambda.Function(this, 'AsyncFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'async_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../..', 'backend'), {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -r *.py prompts/ /asset-output/',
          ],

        },
      }),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      reservedConcurrentExecutions: 5,
      deadLetterQueue: dlq,
      environment: {
        WASP_TABLE_NAME: props.table.tableName,
        POWERTOOLS_SERVICE_NAME: 'wasp-async',
      },
      architecture: lambda.Architecture.ARM_64,
    });

    // Grant DynamoDB access
    props.table.grantReadWriteData(this.apiFunction);
    props.table.grantReadWriteData(this.asyncFunction);

    // Grant KMS access
    props.kmsKey.grantDecrypt(this.apiFunction);
    props.kmsKey.grantDecrypt(this.asyncFunction);
    props.kmsKey.grantEncrypt(this.apiFunction);
    props.kmsKey.grantEncrypt(this.asyncFunction);

    // Grant WAFR, Bedrock, STS access — scoped per function
    // API function: WAFR read+write, Bedrock (model listing + Q&A), STS (verify endpoint)
    this.apiFunction.addToRolePolicy(wafrReadPolicy);
    this.apiFunction.addToRolePolicy(wafrWritePolicy);
    this.apiFunction.addToRolePolicy(bedrockPolicy);
    this.apiFunction.addToRolePolicy(bedrockRuntimePolicy);
    this.apiFunction.addToRolePolicy(stsPolicy);

    // Async function: WAFR read (for summary generation), Bedrock (for AI inference), DynamoDB (for job status)
    // No STS, no WAFR write, no Lambda invoke needed
    this.asyncFunction.addToRolePolicy(wafrReadPolicy);
    this.asyncFunction.addToRolePolicy(bedrockPolicy);
    this.asyncFunction.addToRolePolicy(bedrockRuntimePolicy);

    // Grant API function permission to invoke Async function
    this.asyncFunction.grantInvoke(this.apiFunction);

    // Set async function name on API function (must be after async is created)
    this.apiFunction.addEnvironment('ASYNC_FUNCTION_NAME', this.asyncFunction.functionName);
  }
}
