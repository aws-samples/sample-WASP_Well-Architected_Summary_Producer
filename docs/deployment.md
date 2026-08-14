# Deployment Guide

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |
| Python | 3.10+ | `python3 --version` |
| AWS CDK | 2.x | `npx cdk --version` |
| AWS CLI | 2.x | `aws --version` |
| Docker | — | `docker --version` |
| AWS credentials | — | `aws sts get-caller-identity` |

You also need at least one workload in the [AWS Well-Architected Tool](https://console.aws.amazon.com/wellarchitected/).

---

## Deploy

### Step 1 — Clone and build the frontend

```bash
git clone <repo-url>
cd sample-WASP_Well-Architected_Summary_Producer
cd frontend && npm install && npm run build && cd ..
```

### Step 2 — Deploy with AWS CDK

Docker must be running for AWS Lambda bundling.

```bash
cd cdk
npm install
npx cdk bootstrap -c adminEmail=you@example.com   # First time only — sets up CDK in your account
npx cdk deploy -c adminEmail=you@example.com
```

Replace `you@example.com` with the email address you want to use for the initial admin user. Amazon Cognito will send a temporary password to this address.

### What gets deployed

| Resource | Purpose |
|----------|---------|
| Amazon CloudFront Distribution | HTTPS frontend (TLS 1.2+, redirect HTTP→HTTPS) |
| Amazon S3 Bucket | Private bucket for React build (Origin Access Control, block all public access) |
| Amazon Cognito User Pool | Invite-only auth with Hosted UI |
| Amazon API Gateway (REST) | API endpoint with Cognito JWT authorizer |
| AWS Lambda (API) | Sync API handler |
| AWS Lambda (Async) | Long-running AI operations (15min timeout) |
| Amazon DynamoDB Table | State persistence (KMS encrypted, PITR enabled) |
| AWS KMS Key | Customer managed key for DynamoDB encryption |

### Step 3 — Sign in

1. Check your email for the temporary password from Amazon Cognito
2. Visit the Amazon CloudFront URL from the AWS CDK output
3. Sign in with your email and the temporary password
4. Set a new password when prompted
5. Set up TOTP MFA when prompted (scan the QR code with an authenticator app such as Google Authenticator or Authy)

### Adding additional users

Users cannot self-register. To invite another user:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId from CDK output> \
  --username new-user@example.com \
  --user-attributes Name=email,Value=new-user@example.com Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

All users share the same Amazon DynamoDB state (workload prioritisations, AI summaries).

---

## Configuration

No `.env` file is needed for hosted deployments. All configuration is handled by CDK via AWS Lambda environment variables:

| Variable | Set By | Purpose |
|----------|--------|---------|
| `WASP_TABLE_NAME` | CDK | DynamoDB table name |
| `ASYNC_FUNCTION_NAME` | CDK | Async Lambda function name |

The frontend loads configuration from `/config.json` (deployed to S3 by CDK) which contains the API URL, Cognito User Pool ID, and client ID.

---

## AI Mode (Amazon Bedrock)

WASP includes an optional AI Mode powered by Amazon Bedrock. Toggle it on via the "AI Mode" switch in the top banner and select a model from the dropdown.

### Features

- **Business Summary** — Generates an executive-friendly summary of the review's risk posture, critical findings, and remediation priorities. Generating also creates up to 20 best practice summaries on the Improvement Plan tab, prioritised by high risk findings first. These are cached — for example, if there are 25 items, the first run summarises 20, the second run summarises the remaining 5, and subsequent runs use the cache instantly. The first run may take up to 5 minutes. The business summary itself is also saved and loads automatically on return — click Regenerate to overwrite it with a fresh version.
- **Q&A** — Ask follow-up questions with full context of the review
- **Recommend Positions** — Eisenhower matrix positions are suggested based on the business summary. This feature requires a large, highly capable model to produce meaningful results. Smaller models will typically place all findings on a diagonal line rather than distributing them across all four quadrants. If the results look clustered or diagonal, try a larger model.

### Supported Lenses

The following lenses are tested with AI Mode best practice summaries and documentation links:

- AWS Well-Architected Framework
- SaaS Lens
- Serverless Lens
- Generative AI Lens
- Machine Learning Lens

Other lenses may work but have not been fully validated. The tool will display findings for any lens but documentation link resolution may be incomplete.

### Async Operations

Business summary generation and position recommendations run as async Lambda invocations (running up to 15 minutes). The frontend polls for completion automatically — you'll see a loading spinner until the result is ready.

### Model Selection

The model dropdown shows only models that are compatible with WASP. The following are automatically filtered out:

- **End-of-life/legacy models** — detected via the Bedrock API lifecycle status, plus a hardcoded list for models the API doesn't always flag correctly
- **Non-text models** — image/video/audio generation and embedding models that don't support the Converse API
- **Models requiring data retention opt-in** — some newer models require account-level `provider_data_share` configuration before use
- **Cross-region models** — only foundation models available in the deployment region are shown. Cross-region inference profiles are not used; the model list is sourced directly from the Bedrock ListFoundationModels API which returns only models in the current region.

If a model you expect to see is missing, it may be EOL, not enabled in your account's region, or require data retention opt-in.

### Prompt Templates

All prompts are stored as editable text files in `backend/prompts/`. To customise AI behaviour, edit these files and redeploy:

| File | Purpose |
|------|---------|
| `business_summary.txt` | Main business summary generation |
| `business_summary_qa.txt` | Follow-up Q&A system prompt |
| `positions_qa.txt` | Q&A about position recommendations |
| `summarise_resource.txt` | Full-page best practice summarisation |
| `summarise_resource_step.txt` | Step-based URL summarisation |
| `recommend_positions.txt` | Eisenhower matrix position recommendations |

### Caching

All AI-generated content is cached in Amazon DynamoDB per workload/lens to avoid redundant Amazon Bedrock calls. Use "Regenerate" to overwrite cached content.

---

## Troubleshooting

### CDK deploy fails

```bash
# Ensure CDK is bootstrapped in your account/region
npx cdk bootstrap

# Check AWS credentials
aws sts get-caller-identity

# Verify you have permissions to create IAM roles, Lambda, CloudFront, etc.
```

### Can't sign in

- Check your email (including spam) for the Amazon Cognito temporary password
- If expired, reset via: `aws cognito-idp admin-set-user-password --user-pool-id <ID> --username <email> --password <temp> --temporary`

### Can't fetch workloads

- Verify you have workloads in the WAFR Tool in the **same region** as the CDK deployment
- Check AWS Lambda CloudWatch logs for permission errors

### AI operations timing out

- Business summary with 20+ findings can take 3-5 minutes
- The async AWS Lambda has a 15-minute timeout — if it's failing, check CloudWatch logs for the async function (name in CDK outputs)
- Ensure Amazon Bedrock model access is enabled in your account for the selected model

---

## Teardown

Remove all deployed resources:

```bash
# 1. Disable DynamoDB deletion protection (required before destroy)
aws dynamodb update-table \
  --table-name $(aws cloudformation describe-stack-resources --stack-name WaspStack \
    --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId" \
    --output text) \
  --no-deletion-protection-enabled

# 2. Destroy the stack (from the cdk/ directory)
cd cdk
npx cdk destroy -c adminEmail=dummy@example.com
```

> **Note**: DynamoDB deletion protection is enabled by default. Step 1 is required or `cdk destroy` will fail. All saved prioritisation data will be lost.

> **Note**: If destroy fails because the log bucket is not empty, empty it manually and retry:
> ```bash
> aws s3 rm s3://<bucket-name-from-error> --recursive
> npx cdk destroy -c adminEmail=dummy@example.com
> ```

---

## Cost Considerations

### Important Cost Disclaimer

You are responsible for the cost of the AWS services used while running this sample. WASP deploys serverless infrastructure that scales to zero when not in use. Actual costs may vary based on usage patterns, AWS region, and current pricing. Please verify current pricing on the AWS pricing pages linked below before deploying.

### Estimated Runtime Costs (without AI Mode)

These estimates assume minimal single-user usage in us-east-1 as of July 2026. Prices are subject to change.

| Service | Component | Usage | Unit Price (us-east-1) | Monthly Cost |
|---------|-----------|-------|------------------------|--------------|
| [Amazon DynamoDB](https://aws.amazon.com/dynamodb/pricing/) | On-demand reads/writes | ~200 requests/month | $0.25-1.25 per million | < $0.01 |
| [Amazon DynamoDB](https://aws.amazon.com/dynamodb/pricing/) | Storage | < 1 KB per workload/lens | $0.25/GB-month | < $0.01 |
| [AWS KMS](https://aws.amazon.com/kms/pricing/) | Customer managed keys | 2 keys (DynamoDB + API logs) | $1.00/key/month | $2.00 |
| [Amazon CloudFront](https://aws.amazon.com/cloudfront/pricing/) | Data transfer | < 1 GB/month typical | First 1 TB free | $0.00 |
| [Amazon S3](https://aws.amazon.com/s3/pricing/) | Storage | ~5 MB (React build) | $0.023/GB-month | < $0.01 |
| [AWS Lambda](https://aws.amazon.com/lambda/pricing/) | Invocations | ~500/month | First 1M free | $0.00 |
| [Amazon Cognito](https://aws.amazon.com/cognito/pricing/) | Monthly active users (Plus tier) | < 50 | $0.050/MAU | < $2.50 |
| [Amazon API Gateway](https://aws.amazon.com/api-gateway/pricing/) | API calls | ~500/month | First 1M free | $0.00 |

**Estimated total without AI Mode: ~$4.50/month** (KMS keys + Cognito Plus tier)

### Estimated Costs with AI Mode (Amazon Bedrock)

Estimates based on on-demand [Claude Sonnet 4.5 pricing](https://aws.amazon.com/bedrock/pricing/) ($3.00 per 1M input tokens, $15.00 per 1M output tokens). Actual costs depend on number of findings, documentation page lengths, questions asked, and model selected.

| Service | Operation | Typical Tokens | Estimated Cost per Call |
|---------|-----------|---------------|------------------------|
| [Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) | Business Summary | ~8K input, ~2K output | ~$0.05 |
| [Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) | Best Practice Summaries (20 items) | ~2K input × 20, ~400 output × 20 | ~$0.24 |
| [Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) | Q&A (per question) | ~4K input, ~500 output | ~$0.02 |
| [Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) | Recommend Positions | ~6K input, ~2K output | ~$0.05 |

A typical first-time review with all AI features costs approximately **$0.36 total**. Subsequent sessions use cached results at no additional cost unless you click "Regenerate".

**To minimise costs**: select a smaller model (e.g. Claude Haiku 4.5 at $1.00/$5.00 per 1M tokens, or Amazon Nova Lite) from the dropdown — reduces AI costs by 60-80%.

> **Tip**: Set a [billing alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/monitor_estimated_charges_with_cloudwatch.html) in AWS to notify you if costs exceed expected amounts.

### Cost Optimisation Tips

- **Destroy when not in use**: Run `npx cdk destroy` to remove all resources. Redeploy when needed.
- **Use a smaller model for AI Mode**: Select a smaller model such as Claude Haiku 4.5 or Amazon Nova Lite from the dropdown.
- **Rely on caching**: AI summaries are cached per workload/lens. Avoid "Regenerate" unless you need a fresh summary.
- **Free tier benefits**: New AWS accounts receive free tier benefits for AWS Lambda, Amazon API Gateway, Amazon CloudFront, Amazon DynamoDB, and Amazon Cognito.

### Important Reminders

> ⚠️ **Remember to clean up resources after testing!** See the Teardown section above.

> ⚠️ **Costs vary by region**: Estimates above are for us-east-1.

> ⚠️ **Usage-based pricing**: Actual costs depend on your usage patterns.
