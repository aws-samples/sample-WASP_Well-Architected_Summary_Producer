# WASP Architecture

## System Overview

WASP is a fully serverless application deployed in your AWS account via CDK. Users access a React frontend served by CloudFront, authenticate via Cognito Hosted UI, and interact with a Python Lambda backend through API Gateway.

```mermaid
graph TB
    subgraph Users["👤 Users"]
        Browser["Browser"]
    end

    subgraph AWS["☁️ AWS Account"]
        subgraph Frontend["Frontend (Static)"]
            CF["Amazon CloudFront<br/>(HTTPS, TLS 1.2+)"]
            S3["Amazon S3 Bucket<br/>(Private, OAC)"]
            CF -->|"Origin Access Control"| S3
        end

        subgraph Auth["Authentication"]
            COGNITO["Amazon Cognito User Pool<br/>(Invite-only, Hosted UI)"]
        end

        subgraph API["API Layer"]
            APIGW["Amazon API Gateway<br/>(REST, Cognito JWT Authorizer)"]
            SYNC["AWS Lambda: API<br/>(29s timeout, sync)"]
            ASYNC["AWS Lambda: Async<br/>(15min timeout, async)"]
            APIGW -->|"JWT validated"| SYNC
            SYNC -->|"InvokeAsync"| ASYNC
        end

        subgraph Data["Data & AI"]
            DDB["Amazon DynamoDB<br/>(KMS encrypted, PITR)"]
            KMS["AWS KMS<br/>(Customer managed key)"]
            WAFR["AWS Well-Architected Tool"]
            BRK["Amazon Bedrock<br/>(Converse API)"]
            DDB -.->|"encrypted by"| KMS
        end

        subgraph Audit["Audit"]
            CT["AWS CloudTrail<br/>(All API calls logged)"]
        end
    end

    Browser -->|"HTTPS"| CF
    Browser -->|"OAuth2 Code Flow"| COGNITO
    Browser -->|"Bearer token"| APIGW
    SYNC --> DDB
    SYNC --> WAFR
    ASYNC --> DDB
    ASYNC --> WAFR
    ASYNC --> BRK

    style Frontend fill:#e8f4ff,stroke:#0073BB
    style Auth fill:#ffe8e8,stroke:#E91E8C
    style API fill:#e8f8e8,stroke:#1D8102
    style Data fill:#fff3e0,stroke:#FF9900
    style Audit fill:#f5f5f5,stroke:#666
```

---

## Authentication Flow

Users authenticate via Amazon Cognito Hosted UI. Amazon API Gateway validates JWT tokens before requests reach AWS Lambda.

```mermaid
sequenceDiagram
    participant User as Browser
    participant CF as Amazon CloudFront
    participant Cognito as Amazon Cognito
    participant APIGW as Amazon API Gateway
    participant Lambda as AWS Lambda

    User->>CF: Visit app URL
    CF-->>User: React SPA
    User->>Cognito: Sign in (Hosted UI)
    Cognito-->>User: Authorization code
    User->>Cognito: Exchange code for tokens
    Cognito-->>User: ID token + Access token
    User->>APIGW: API request + Bearer token
    APIGW->>APIGW: Validate JWT (Cognito authorizer)
    APIGW->>Lambda: Forward request
    Lambda-->>APIGW: Response
    APIGW-->>User: JSON response
```

---

## Data Flow — Loading a Workload

When a user selects a workload and lens, four API calls fire in parallel to minimise load time.

```mermaid
sequenceDiagram
    participant Browser
    participant Lambda as AWS Lambda
    participant WAFR as WAFR Tool
    participant DDB as DynamoDB

    Browser->>Lambda: GET /api/workloads
    Lambda->>WAFR: ListWorkloads
    WAFR-->>Lambda: Workload list
    Lambda-->>Browser: Workload list

    Browser->>Lambda: GET /api/workloads/:id
    Lambda->>WAFR: GetWorkload
    WAFR-->>Lambda: Workload details + lenses
    Lambda-->>Browser: Workload + lenses list

    Note over Browser: User selects a lens

    par Parallel API calls
        Browser->>Lambda: GET /api/workloads/:id/lens-review
        Lambda->>WAFR: GetLensReview
        WAFR-->>Lambda: Pillar summaries
        Lambda-->>Browser: Lens review data
    and
        Browser->>Lambda: GET /api/workloads/:id/improvements
        Lambda->>WAFR: ListLensReviewImprovements
        WAFR-->>Lambda: Improvement list
        Lambda-->>Browser: Findings
    and
        Browser->>Lambda: GET /api/workloads/:id/answers
        Lambda->>WAFR: ListAnswers + GetAnswer (parallel)
        WAFR-->>Lambda: All answers with choices
        Lambda-->>Browser: Answers with selection state
    and
        Browser->>Lambda: GET /api/prioritizations/:key
        Lambda->>DDB: GetItem
        DDB-->>Lambda: Saved positions + completed items
        Lambda-->>Browser: Saved state
    end

    Note over Browser: Build findings list, overlay saved positions
```

---

## Data Flow — Creating a Milestone

```mermaid
sequenceDiagram
    participant Browser
    participant Lambda as AWS Lambda
    participant WAFR as WAFR Tool
    participant DDB as DynamoDB

    Note over Browser: User clicks "Create Milestone"

    loop For each completed finding
        Browser->>Lambda: PUT /api/workloads/:id/answers/:questionId
        Note over Lambda: Merge existing + new choices
        Lambda->>WAFR: UpdateAnswer (all best practices selected)
        WAFR-->>Lambda: Updated answer
        Lambda-->>Browser: Success
    end

    loop For each pending reset
        Browser->>Lambda: PUT /api/workloads/:id/answers/:questionId (replaceMode)
        Note over Lambda: Restore previous choices
        Lambda->>WAFR: UpdateAnswer (previous choices only)
        WAFR-->>Lambda: Updated answer
        Lambda-->>Browser: Success
    end

    Note over Browser: Wait 2s for AWS to process

    Browser->>Lambda: POST /api/workloads/:id/milestones
    Lambda->>WAFR: CreateMilestone
    WAFR-->>Lambda: Milestone number
    Lambda-->>Browser: Milestone created

    Browser->>Lambda: PUT /api/prioritizations/:key
    Note over Lambda: Save milestone numbers + positions
    Lambda->>DDB: UpdateItem
    DDB-->>Lambda: Updated record
    Lambda-->>Browser: Saved

    Note over Browser: Reload lens data to refresh all views

    par Parallel reload
        Browser->>Lambda: GET /api/workloads/:id/lens-review
        Lambda->>WAFR: GetLensReview
        WAFR-->>Lambda: Updated pillar summaries
        Lambda-->>Browser: Lens review data
    and
        Browser->>Lambda: GET /api/workloads/:id/improvements
        Lambda->>WAFR: ListLensReviewImprovements
        WAFR-->>Lambda: Updated improvement list
        Lambda-->>Browser: Findings (completed items removed)
    and
        Browser->>Lambda: GET /api/workloads/:id/answers
        Lambda->>WAFR: ListAnswers + GetAnswer
        WAFR-->>Lambda: Updated answers
        Lambda-->>Browser: Answers with new selections
    and
        Browser->>Lambda: GET /api/prioritizations/:key
        Lambda->>DDB: GetItem
        DDB-->>Lambda: Saved state with milestone numbers
        Lambda-->>Browser: Saved state
    end
```

---

## Frontend Component Tree

```mermaid
graph TD
    App["App.js<br/>(state: workload, lens, positions, completedItems,<br/>aiMode, aiModel, aiSummaries, businessSummary)"]

    App --> WS["WorkloadSelector<br/>(list + select workload)"]
    App --> LS["LensSelector<br/>(shown when workload has multiple lenses)"]
    App --> Nav["Navigation<br/>(tab bar)"]
    App --> OV["Overview<br/>(risk summary by pillar)"]
    App --> FW["Framework<br/>(WA pillar descriptions)"]
    App --> LO["LensOverview<br/>(pillar table with risk counts)"]
    App --> IP["ImprovementPlan<br/>(findings grouped by pillar)"]
    App --> PD["PillarDetails<br/>(slide-style pillar breakdown)"]
    App --> FP["FindingsPlot<br/>(drag-and-drop Eisenhower matrix)"]
    App --> IM["ImplementationPlan<br/>(phased roadmap + milestones)"]
    App --> RS["Resources<br/>(AWS links)"]

    style App fill:#FF9900,color:#fff
    style FP fill:#0073BB,color:#fff
    style IM fill:#0073BB,color:#fff
```

---

## DynamoDB Data Model

Each record is keyed by `{workloadId}-{sanitizedLensAlias}` so each workload+lens combination has its own saved state.

```mermaid
erDiagram
    PRIORITIZATION {
        string workloadId PK "e.g. abc123-wellarchitected"
        map plotPositions "questionId → {x, y, staged, completed}"
        map completedItems "storageKey-questionId → {completedAt, questionId, questionTitle, pillar, lensAlias, originalPosition, milestoneNumber, wasReset, previouslySelected}"
        map riskFilter "{high: bool, medium: bool}"
        map aiSummaries "url → summary text (AI Mode)"
        map businessSummary "{summary, modelId, inputTokens, outputTokens} (AI Mode)"
        string aiSummariesUpdatedAt "ISO timestamp (AI Mode)"
        string businessSummaryUpdatedAt "ISO timestamp (AI Mode)"
        string notes
        string updatedAt
        string updatedBy
    }
```

**plotPositions** — keyed by `questionId`, stores the x/y coordinates on the 600×600 plot:
- `staged: true` → circle is in the right-hand staging area (not yet placed)
- `completed: true` → circle is in the completed zone below the plot
- `x, y` → pixel coordinates on the plot canvas

**completedItems** — keyed by `{storageKey}-{questionId}`:
- `completedAt` — ISO timestamp when the item was marked complete
- `questionId` — the WAFR question ID
- `questionTitle` — human-readable question title
- `pillar` — which WA pillar this question belongs to
- `lensAlias` — which lens this completion belongs to
- `originalPosition` — the x/y plot position before completion (used to keep the item in its quadrant)
- `milestoneNumber` — set when the item was locked into a milestone
- `wasReset` — set when the item was un-completed via "Reset Question"
- `previouslySelected` — the choices that were selected before completion (used to restore on reset)

---

## URL Scheme for Best Practice Links

Different lenses use different documentation URL patterns:

```mermaid
graph LR
    Choice["Best Practice Choice"]
    
    Choice -->|"SaaS / Serverless lens"| WA["wa.aws.amazon.com<br/>/{lens}/{version}/{prefix}.question.{ID}.en.html#step{N}"]
    Choice -->|"WA Framework + docs lenses<br/>(GenAI, ML, etc.)"| DOCS["docs.aws.amazon.com<br/>/wellarchitected/latest/{slug}/{questionId}.html"]
    Choice -->|"Choice has improvementPlan.Url"| DIRECT["Use URL directly from AWS API"]
```

---

## IAM Permission Model

```mermaid
graph LR
    APIGW["Amazon API Gateway"]
    SYNC["AWS Lambda: API"]
    ASYNC["AWS Lambda: Async"]
    DDB["Amazon DynamoDB"]
    KMS["AWS KMS"]
    WAFR["AWS Well-Architected Tool"]
    BRK["Amazon Bedrock"]

    APIGW -->|"Invoke"| SYNC
    SYNC -->|"InvokeAsync"| ASYNC
    SYNC --> DDB
    SYNC --> WAFR
    ASYNC --> DDB
    ASYNC --> WAFR
    ASYNC --> BRK
    DDB -.->|"Encrypt/Decrypt"| KMS
```

Lambda execution roles are scoped per-function:
- WAFR write actions restricted to `arn:aws:wellarchitected:*:ACCOUNT:workload/*`
- DynamoDB scoped to the specific prioritization table
- KMS scoped to the table encryption key
- Bedrock runtime scoped to `arn:aws:bedrock:REGION::foundation-model/*`
- Only the API Lambda can invoke the Async Lambda (no other callers)

---

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Serverless compute** | Lambda scales to zero — no idle cost, no servers to patch |
| **CloudFront + private S3** | Static frontend served via CDN with OAC — no public bucket |
| **Cognito invite-only** | No self-signup, admin creates users — suitable for team use |
| **API Gateway + JWT authorizer** | Auth validated at gateway level — Lambda never sees unauthenticated requests |
| **Async Lambda for AI** | 15-minute timeout for summary generation — avoids API Gateway 29s limit |
| **DynamoDB for state** | Serverless, pay-per-request, KMS encrypted, point-in-time recovery |
| **Per-lens storage key** | `{workloadId}-{lensAlias}` isolates state between lenses |
| **Parallel API calls** | Loading a lens fires 4 API calls simultaneously to minimise perceived latency |
| **Debounced auto-save** | 3-second debounce on drag events prevents excessive DynamoDB writes |
| **AI Mode via Bedrock** | Uses the Converse API for model-agnostic inference |
| **Editable prompt templates** | Prompts are plain text files — edit and redeploy to customise AI behaviour |
| **AI summary caching** | Per-URL and per-workload/lens caching avoids redundant Bedrock calls |

