"""
Async Lambda handler for WASP — handles long-running operations.

Operations:
- generate_summary: Business summary + best practice summaries (up to 5 min)
- recommend_positions: AI-recommended Eisenhower matrix positions (up to 2 min)

Results are written to DynamoDB. The frontend polls /api/jobs/{jobId} for status.
"""
import json
import os
import traceback
import boto3
from datetime import datetime

# Initialize AWS clients
# CDK sets WASP_TABLE_NAME via Lambda environment variables

# Import the Flask app's core functions (reuse existing logic)
from app import init_aws_clients

init_aws_clients()

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['WASP_TABLE_NAME'])


def handler(event, context):
    """Async Lambda handler — processes long-running WASP operations."""
    operation = event.get('operation')
    job_id = event.get('jobId')
    original_event = event.get('originalEvent', {})
    
    try:
        # Store job as IN_PROGRESS
        _update_job_status(job_id, 'PROCESSING')
        
        if operation == 'generate_summary':
            result = _handle_generate_summary(original_event)
        elif operation == 'recommend_positions':
            result = _handle_recommend_positions(original_event)
        else:
            result = {'error': f'Unknown operation: {operation}'}
        
        # Store completed result
        _update_job_status(job_id, 'COMPLETED', result)
        
    except Exception as e:
        traceback.print_exc()
        _update_job_status(job_id, 'FAILED', {
            'error': str(e),
            'type': type(e).__name__,
        })


def _update_job_status(job_id, status, result=None):
    """Write job status to DynamoDB for frontend polling."""
    item = {
        'workloadId': f'job-{job_id}',
        'status': status,
        'updatedAt': datetime.utcnow().isoformat(),
    }
    if result:
        # Store as JSON string to avoid DynamoDB Decimal conversion issues
        item['result'] = json.dumps(result)
    
    table.put_item(Item=item)


def _handle_generate_summary(event):
    """Generate business summary and best practice summaries.
    
    Calls the same Flask route logic but runs without the 29s timeout.
    """
    from app import app as flask_app
    
    body = event.get('body', '{}')
    headers = {}
    if event.get('headers'):
        headers = {k: v for k, v in event['headers'].items() if k.lower() != 'host'}
    
    with flask_app.test_client() as client:
        response = client.post(
            '/api/bedrock/generate-summary',
            data=body,
            content_type='application/json',
            headers=headers,
        )
        result = response.get_json()
        if response.status_code != 200:
            raise Exception(f"Flask route returned {response.status_code}: {result}")
        return result


def _handle_recommend_positions(event):
    """Generate AI-recommended positions for all findings."""
    from app import app as flask_app
    
    body = event.get('body', '{}')
    headers = {}
    if event.get('headers'):
        headers = {k: v for k, v in event['headers'].items() if k.lower() != 'host'}
    
    with flask_app.test_client() as client:
        response = client.post(
            '/api/bedrock/recommend-positions',
            data=body,
            content_type='application/json',
            headers=headers,
        )
        result = response.get_json()
        if response.status_code != 200:
            raise Exception(f"Flask route returned {response.status_code}: {result}")
        return result
