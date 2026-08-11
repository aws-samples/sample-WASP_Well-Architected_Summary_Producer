#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { WaspStack } from '../lib/wasp-stack';

const app = new cdk.App();

// cdk-nag: check all constructs against AWS Solutions rules
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));

const adminEmail = app.node.tryGetContext('adminEmail');
if (!adminEmail) {
  throw new Error('adminEmail is required. Deploy with: npx cdk deploy -c adminEmail=you@example.com');
}

new WaspStack(app, 'WaspStack', {
  adminEmail,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
