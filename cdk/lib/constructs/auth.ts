import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthConstructProps {
  adminEmail: string;
}

export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly domainPrefix: string;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    // Domain prefix must be globally unique across all Cognito users.
    // Use a fixed prefix — users can override via context if it conflicts.
    const stack = cdk.Stack.of(this);
    this.domainPrefix = `wasp-${stack.node.addr.substring(0, 8)}`.toLowerCase();

    // Cognito User Pool — invite-only (no self-signup)
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Set the Cognito Plus tier (feature plan) for advanced security
    const cfnUserPool = this.userPool.node.defaultChild as cdk.CfnResource;
    cfnUserPool.addPropertyOverride('UserPoolTier', 'PLUS');

    // Cognito domain for Hosted UI
    this.userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: this.domainPrefix,
      },
    });

    // App client — used by the frontend
    this.userPoolClient = new cognito.UserPoolClient(this, 'AppClient', {
      userPool: this.userPool,
      userPoolClientName: 'wasp-frontend',
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        // Callback URLs updated post-deploy via custom resource or manually
        callbackUrls: ['https://localhost/'],
        logoutUrls: ['https://localhost/'],
      },
      preventUserExistenceErrors: true,
      generateSecret: false,
    });

    // Create initial admin user (invite-only — they receive email with temp password)
    new cognito.CfnUserPoolUser(this, 'AdminUser', {
      userPoolId: this.userPool.userPoolId,
      username: props.adminEmail,
      userAttributes: [
        { name: 'email', value: props.adminEmail },
        { name: 'email_verified', value: 'true' },
      ],
      desiredDeliveryMediums: ['EMAIL'],
    });
  }
}
