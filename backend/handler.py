"""
Lambda handler for WASP API — wraps the Flask app using apig-wsgi.
Handles synchronous API Gateway requests (< 29s timeout).

For long-running operations (business summary generation, recommend positions),
this handler invokes the async Lambda and returns a job ID for polling.
"""
import json
import os
import uuid
import boto3
from apig_wsgi import make_lambda_handler
from app import app, init_aws_clients

# Initialize AWS clients on cold start
init_aws_clients()

# apig-wsgi adapter — translates API Gateway events to Flask WSGI
_wsgi_handler = make_lambda_handler(app)

# Lambda client for invoking async function
lambda_client = boto3.client('lambda')
ASYNC_FUNCTION_NAME = os.environ.get('ASYNC_FUNCTION_NAME', 'wasp-async')


def handler(event, context):
    """Main Lambda handler.
    
    Routes long-running operations to the async Lambda, everything else
    goes through the Flask app via apig-wsgi.
    """
    # Check if this is a long-running operation that should be async
    path = event.get('path', '') or event.get('rawPath', '')
    method = event.get('httpMethod', '') or event.get('requestContext', {}).get('http', {}).get('method', '')
    
    if method == 'POST' and 'bedrock/generate-summary' in path:
        return _invoke_async(event, context, 'generate_summary')
    
    if method == 'POST' and 'bedrock/recommend-positions' in path:
        return _invoke_async(event, context, 'recommend_positions')

    # All other requests go through Flask
    return _wsgi_handler(event, context)


def _invoke_async(event, context, operation):
    """Invoke the async Lambda and return a job ID for polling."""
    job_id = str(uuid.uuid4())
    
    # Pass the original event to the async function with job metadata
    async_payload = {
        'operation': operation,
        'jobId': job_id,
        'originalEvent': event,
    }
    
    lambda_client.invoke(
        FunctionName=ASYNC_FUNCTION_NAME,
        InvocationType='Event',  # Async invocation
        Payload=json.dumps(async_payload),
    )
    
    return {
        'statusCode': 202,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': os.environ.get('CORS_ORIGIN', '*'),
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        'body': json.dumps({
            'jobId': job_id,
            'status': 'PROCESSING',
            'message': 'Operation started. Poll /api/jobs/{jobId} for status.',
        }),
    }
