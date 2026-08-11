import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export class DatabaseConstruct extends Construct {
  public readonly table: dynamodb.Table;
  public readonly kmsKey: kms.Key;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // KMS key for DynamoDB encryption at rest
    this.kmsKey = new kms.Key(this, 'TableKey', {
      description: 'WASP DynamoDB table encryption key',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB table
    this.table = new dynamodb.Table(this, 'PrioritizationTable', {
      partitionKey: {
        name: 'workloadId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.kmsKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: true,
    });
  }
}
