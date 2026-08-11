"""
WASP Backend - Well-Architected Summary Producer
Python Flask backend with AWS integration
"""
import os
import json
import traceback
import time
from datetime import datetime
from decimal import Decimal
from flask import Flask, request, jsonify
from flask_cors import CORS
import boto3
from botocore.exceptions import ClientError
from functools import wraps
import requests as http_requests
import re
from bs4 import BeautifulSoup

app = Flask(__name__)

# CORS configuration — restricted to the deployed CloudFront origin
_cors_origin = os.environ.get('CORS_ORIGIN', 'http://localhost:3000')
CORS(app, origins=[_cors_origin], supports_credentials=False)

# Security headers
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# AWS Clients
wellarchitected = None
dynamodb = None
dynamodb_table = None
bedrock = None
bedrock_runtime = None

def init_aws_clients():
    """Initialize AWS service clients using the default credential chain.

    In Lambda, credentials come from the execution role.
    In local development, boto3 resolves from environment variables or ~/.aws/credentials.
    """
    global wellarchitected, dynamodb, dynamodb_table, bedrock, bedrock_runtime

    wellarchitected = boto3.client('wellarchitected')
    dynamodb = boto3.resource('dynamodb')
    bedrock = boto3.client('bedrock')
    bedrock_runtime = boto3.client('bedrock-runtime')

    table_name = os.environ.get('WASP_TABLE_NAME', 'wasp-prioritization')
    dynamodb_table = dynamodb.Table(table_name)

def require_auth(f):
    """Decorator for protected routes. Catches AWS credential errors and returns 401."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except ClientError as e:
            app.logger.error(f"AWS credential error: {str(e)}")
            return jsonify({'error': 'Invalid or expired AWS credentials'}), 401
        except Exception as e:
            app.logger.error(f"Authentication error: {str(e)}")
            return jsonify({'error': 'Authentication failed'}), 401
    return decorated_function

# ============================================================================
# WORKLOAD OPERATIONS
# ============================================================================

@app.route('/api/workloads', methods=['GET'])
@require_auth
def list_workloads():
    """List all workloads in the account.

    Note: This fetches only the first page (up to 50 workloads). The NextToken
    is returned in the response so the frontend could request subsequent pages,
    but the WorkloadSelector UI currently loads all workloads in a single call.
    If you have more than 50 workloads, add pagination support here and in the
    frontend WorkloadSelector component.
    """
    try:
        response = wellarchitected.list_workloads(MaxResults=50)
        
        workloads = []
        for summary in response.get('WorkloadSummaries', []):
            workloads.append({
                'workloadId': summary['WorkloadId'],
                'workloadName': summary['WorkloadName'],
                'owner': summary.get('Owner', 'Unknown'),
                'updatedAt': summary.get('UpdatedAt').isoformat() if summary.get('UpdatedAt') else None,
                'riskCounts': summary.get('RiskCounts', {}),
                'lenses': summary.get('Lenses', [])
            })
        
        return jsonify({
            'workloads': workloads,
            'nextToken': response.get('NextToken')
        })
    
    except ClientError as e:
        app.logger.error(f"Error listing workloads: {str(e)}")
        return jsonify({'error': 'Failed to retrieve workloads'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error listing workloads: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>', methods=['GET'])
@require_auth
def get_workload(workload_id):
    """Get detailed workload information"""
    try:
        response = wellarchitected.get_workload(WorkloadId=workload_id)
        workload = response['Workload']
        
        return jsonify({
            'workloadId': workload['WorkloadId'],
            'workloadName': workload['WorkloadName'],
            'description': workload.get('Description', ''),
            'environment': workload.get('Environment', ''),
            'owner': workload.get('Owner', ''),
            'reviewOwner': workload.get('ReviewOwner', ''),
            'updatedAt': workload.get('UpdatedAt').isoformat() if workload.get('UpdatedAt') else None,
            'accountIds': workload.get('AccountIds', []),
            'awsRegions': workload.get('AwsRegions', []),
            'architecturalDesign': workload.get('ArchitecturalDesign', ''),
            'industry': workload.get('Industry', ''),
            'industryType': workload.get('IndustryType', ''),
            'lenses': workload.get('Lenses', []),
            'riskCounts': workload.get('RiskCounts', {})
        })
    
    except ClientError as e:
        app.logger.error(f"Error getting workload {workload_id}: {str(e)}")
        return jsonify({'error': 'Workload not found'}), 404
    except Exception as e:
        app.logger.error(f"Unexpected error getting workload {workload_id}: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>/lens-review', methods=['GET'])
@require_auth
def get_lens_review(workload_id):
    """Get lens review for a workload"""
    try:
        lens_alias = request.args.get('lensAlias', 'wellarchitected')
        
        response = wellarchitected.get_lens_review(
            WorkloadId=workload_id,
            LensAlias=lens_alias
        )
        
        lens_review = response['LensReview']
        
        # Transform PillarReviewSummaries to camelCase for frontend consistency
        pillar_summaries = []
        for pillar in lens_review.get('PillarReviewSummaries', []):
            pillar_summaries.append({
                'pillarId': pillar.get('PillarId'),
                'pillarName': pillar.get('PillarName'),
                'notes': pillar.get('Notes'),
                'riskCounts': {
                    'UNANSWERED': pillar.get('RiskCounts', {}).get('UNANSWERED', 0),
                    'HIGH': pillar.get('RiskCounts', {}).get('HIGH', 0),
                    'MEDIUM': pillar.get('RiskCounts', {}).get('MEDIUM', 0),
                    'NONE': pillar.get('RiskCounts', {}).get('NONE', 0),
                    'NOT_APPLICABLE': pillar.get('RiskCounts', {}).get('NOT_APPLICABLE', 0)
                }
            })
        
        return jsonify({
            'lensAlias': lens_review['LensAlias'],
            'lensName': lens_review.get('LensName', ''),
            'lensVersion': lens_review.get('LensVersion', ''),
            'updatedAt': lens_review.get('UpdatedAt').isoformat() if lens_review.get('UpdatedAt') else None,
            'riskCounts': lens_review.get('RiskCounts', {}),
            'pillarReviewSummaries': pillar_summaries
        })
    
    except ClientError as e:
        app.logger.error(f"Error getting lens review for {workload_id}: {str(e)}")
        return jsonify({'error': 'Lens review not found'}), 404
    except Exception as e:
        app.logger.error(f"Unexpected error getting lens review: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>/answers', methods=['GET'])
@require_auth
def list_answers(workload_id):
    """List all answers for a workload lens review.

    The AnswerSummary from list_answers already includes Choices (with Title,
    HelpfulResource, ImprovementPlan) and SelectedChoices, so we no longer need
    a separate get_answer call per question. This reduced lens load time from
    ~50s to ~1-2s by eliminating 50+ individual API calls.

    Paginates automatically if there are more than 50 questions.
    """
    start_time = time.time()
    
    try:
        lens_alias = request.args.get('lensAlias', 'wellarchitected')
        pillar_id = request.args.get('pillarId')
        
        params = {
            'WorkloadId': workload_id,
            'LensAlias': lens_alias,
            'MaxResults': 50
        }
        
        if pillar_id:
            params['PillarId'] = pillar_id
        
        # Paginate to collect all answers (some lenses have 50+ questions)
        answer_summaries = []
        while True:
            response = wellarchitected.list_answers(**params)
            answer_summaries.extend(response.get('AnswerSummaries', []))
            next_token = response.get('NextToken')
            if not next_token:
                break
            params['NextToken'] = next_token
        
        list_time = time.time() - start_time
        app.logger.info(f"list_answers: {len(answer_summaries)} answers fetched in {list_time:.2f}s")
        
        # Build answer objects directly from the summary — no extra API calls needed.
        # AnswerSummary.Choices already contains Title, HelpfulResource, ImprovementPlan,
        # and SelectedChoices tells us which are selected.
        answers = []
        for summary in answer_summaries:
            all_choices = summary.get('Choices', [])
            selected_choice_ids = set(summary.get('SelectedChoices', []))
            
            choice_details = []
            for choice in all_choices:
                choice_details.append({
                    'choiceId': choice.get('ChoiceId'),
                    'title': choice.get('Title'),
                    'description': choice.get('Description'),
                    'helpfulResource': choice.get('HelpfulResource', {}),
                    'improvementPlan': choice.get('ImprovementPlan', {}),
                    'selected': choice.get('ChoiceId') in selected_choice_ids
                })
            
            answers.append({
                'questionId': summary['QuestionId'],
                'pillarId': summary['PillarId'],
                'questionTitle': summary['QuestionTitle'],
                'risk': summary.get('Risk', 'UNANSWERED'),
                'choices': choice_details,
                'isApplicable': summary.get('IsApplicable', True),
                'reason': summary.get('Reason')
            })
        
        app.logger.info(f"list_answers: processed {len(answers)} answers in {time.time() - start_time:.2f}s total")
        
        return jsonify({
            'answers': answers,
            'nextToken': None  # We paginated fully, no more pages
        })
    
    except ClientError as e:
        app.logger.error(f"Error listing answers for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to retrieve answers'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error listing answers: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>/improvements', methods=['GET'])
@require_auth
def list_improvements(workload_id):
    """List improvement recommendations"""
    try:
        lens_alias = request.args.get('lensAlias', 'wellarchitected')
        pillar_id = request.args.get('pillarId')
        
        params = {
            'WorkloadId': workload_id,
            'LensAlias': lens_alias,
            'MaxResults': 50
        }
        
        if pillar_id:
            params['PillarId'] = pillar_id
        
        response = wellarchitected.list_lens_review_improvements(**params)
        
        improvements = []
        for item in response.get('ImprovementSummaries', []):
            improvement_plans = item.get('ImprovementPlans', [])
            
            # Log to see what's in improvement plans
            if improvement_plans:
                app.logger.info(f"Question {item['QuestionId']} has {len(improvement_plans)} improvement plans")
                for plan in improvement_plans:
                    app.logger.info(f"  Plan: {plan}")
            
            improvements.append({
                'questionId': item['QuestionId'],
                'pillarId': item['PillarId'],
                'questionTitle': item['QuestionTitle'],
                'risk': item.get('Risk', 'UNANSWERED'),
                'improvementPlanUrl': item.get('ImprovementPlanUrl', ''),
                'improvementPlans': improvement_plans,
                'lensAlias': lens_alias
            })
        
        return jsonify({
            'improvements': improvements,
            'nextToken': response.get('NextToken')
        })
    
    except ClientError as e:
        app.logger.error(f"Error listing improvements for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to retrieve improvements'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error listing improvements: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

# ============================================================================
# MILESTONE OPERATIONS
# ============================================================================

@app.route('/api/workloads/<workload_id>/milestones', methods=['GET'])
@require_auth
def list_milestones(workload_id):
    """List milestones for a workload"""
    try:
        response = wellarchitected.list_milestones(
            WorkloadId=workload_id,
            MaxResults=50
        )
        
        milestones = []
        for summary in response.get('MilestoneSummaries', []):
            milestones.append({
                'milestoneNumber': summary['MilestoneNumber'],
                'milestoneName': summary['MilestoneName'],
                'recordedAt': summary.get('RecordedAt').isoformat() if summary.get('RecordedAt') else None,
                'workloadSummary': summary.get('WorkloadSummary', {})
            })
        
        return jsonify({
            'milestones': milestones,
            'nextToken': response.get('NextToken')
        })
    
    except ClientError as e:
        app.logger.error(f"Error listing milestones for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to retrieve milestones'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error listing milestones: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>/milestones', methods=['POST'])
@require_auth
def create_milestone(workload_id):
    """Create a new milestone"""
    try:
        data = request.json
        milestone_name = data.get('milestoneName', f'WASP Prioritization - {datetime.now().strftime("%Y-%m-%d %H:%M")}')
        
        app.logger.info(f"Creating milestone for workload {workload_id} with name: {milestone_name}")
        
        # Note: create_milestone creates a milestone for ALL lenses in the workload
        # It doesn't take a LensAlias parameter
        response = wellarchitected.create_milestone(
            WorkloadId=workload_id,
            MilestoneName=milestone_name
        )
        
        app.logger.info(f"Successfully created milestone #{response['MilestoneNumber']}")
        
        return jsonify({
            'milestoneNumber': response['MilestoneNumber'],
            'workloadId': response['WorkloadId']
        }), 201
    
    except ClientError as e:
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']
        app.logger.error(f"AWS Error creating milestone for {workload_id}: {error_code} - {error_message}")
        return jsonify({
            'error': 'Failed to create milestone',
            'details': f"{error_code}: {error_message}"
        }), 500
    except Exception as e:
        app.logger.error(f"Unexpected error creating milestone: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': 'An unexpected error occurred', 'details': str(e)}), 500

# ============================================================================
# PRIORITIZATION DATA (DynamoDB)
# ============================================================================

def decimal_to_float(obj):
    """Recursively convert Decimal objects to float for JSON serialization.

    DynamoDB's boto3 resource returns numeric attributes as Python Decimal rather
    than int/float. The standard json module (and Flask's jsonify) can't serialize
    Decimal, so we walk the entire response structure and convert before returning
    data to the frontend.
    """
    if isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(item) for item in obj]
    elif isinstance(obj, Decimal):
        return float(obj)
    return obj


def float_to_decimal(obj):
    """Recursively convert float/int values to Decimal for DynamoDB storage.

    DynamoDB's boto3 resource layer requires Decimal for all numeric types.
    This walks nested dicts/lists and converts any float or int values.
    """
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [float_to_decimal(item) for item in obj]
    elif isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, int) and not isinstance(obj, bool):
        return Decimal(str(obj))
    return obj


# ============================================================================
# ASYNC JOB STATUS (for long-running operations in Lambda)
# ============================================================================

@app.route('/api/jobs/<job_id>', methods=['GET'])
@require_auth
def get_job_status(job_id):
    """Poll for async job completion status."""
    try:
        response = dynamodb_table.get_item(Key={'workloadId': f'job-{job_id}'})
        item = response.get('Item')
        if not item:
            return jsonify({'error': 'Job not found'}), 404

        result = {
            'jobId': job_id,
            'status': item.get('status', 'UNKNOWN'),
            'updatedAt': item.get('updatedAt'),
        }
        if item.get('result'):
            # Result stored as JSON string to avoid DynamoDB Decimal issues
            stored_result = item['result']
            if isinstance(stored_result, str):
                result['result'] = json.loads(stored_result)
            else:
                result['result'] = stored_result

        # Clean up completed/failed jobs after retrieval
        if item.get('status') in ('COMPLETED', 'FAILED'):
            try:
                dynamodb_table.delete_item(Key={'workloadId': f'job-{job_id}'})
            except Exception:
                pass  # Non-critical — job data will be overwritten eventually

        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Error fetching job {job_id}: {e}")
        return jsonify({'error': 'Failed to fetch job status'}), 500


@app.route('/api/prioritizations/<workload_id>', methods=['GET'])
@require_auth
def get_prioritization(workload_id):
    """Get saved prioritization data for a workload"""
    try:
        app.logger.info(f"Fetching prioritization for workload {workload_id}")
        response = dynamodb_table.get_item(
            Key={'workloadId': workload_id}
        )
        
        if 'Item' not in response:
            app.logger.info(f"No prioritization found for workload {workload_id}")
            return jsonify({'prioritization': None}), 404
        
        # Convert Decimal to float for JSON serialization
        item = decimal_to_float(response['Item'])
        
        # Ensure completedItems exists (even if empty) for frontend compatibility
        if 'completedItems' not in item:
            item['completedItems'] = {}
        
        app.logger.info(f"Returning prioritization with {len(item.get('completedItems', {}))} completed items")
        return jsonify({'prioritization': item})
    
    except ClientError as e:
        app.logger.error(f"Error getting prioritization for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to retrieve prioritization data'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error getting prioritization: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/prioritizations/<workload_id>', methods=['PUT'])
@require_auth
def save_prioritization(workload_id):
    """Save prioritization data for a workload (partial update)"""
    try:
        data = request.json
        app.logger.info(f"Received save request for workload {workload_id}, keys: {list(data.keys())}")
        
        # Get current user identity
        sts = boto3.client('sts')
        identity = sts.get_caller_identity()
        
        # Build update expression dynamically based on what's provided
        update_expression_parts = []
        expression_attribute_values = {}
        expression_attribute_names = {}
        
        # Always update timestamp and user
        update_expression_parts.append('#updatedAt = :updatedAt')
        update_expression_parts.append('#updatedBy = :updatedBy')
        expression_attribute_names['#updatedAt'] = 'updatedAt'
        expression_attribute_names['#updatedBy'] = 'updatedBy'
        expression_attribute_values[':updatedAt'] = datetime.now().isoformat()
        expression_attribute_values[':updatedBy'] = identity['Arn']
        
        # Handle plotPositions if provided
        if 'plotPositions' in data:
            plot_positions = data['plotPositions']
            normalized_positions = {}
            
            for key, pos in plot_positions.items():
                if isinstance(pos, dict):
                    normalized_positions[key] = {
                        'x': Decimal(str(pos['x'])) if 'x' in pos else Decimal('0'),
                        'y': Decimal(str(pos['y'])) if 'y' in pos else Decimal('0'),
                        'staged': pos.get('staged', True),
                        'completed': pos.get('completed', False)
                    }
                else:
                    normalized_positions[key] = pos
            
            update_expression_parts.append('#plotPositions = :plotPositions')
            expression_attribute_names['#plotPositions'] = 'plotPositions'
            expression_attribute_values[':plotPositions'] = normalized_positions
        
        # Handle riskFilter if provided
        if 'riskFilter' in data:
            update_expression_parts.append('#riskFilter = :riskFilter')
            expression_attribute_names['#riskFilter'] = 'riskFilter'
            expression_attribute_values[':riskFilter'] = data['riskFilter']
        
        # Handle completedItems if provided
        if 'completedItems' in data:
            completed_items = data['completedItems']
            
            # Only update if not empty
            if completed_items:
                # Convert any float/int values to Decimal for DynamoDB
                completed_items = float_to_decimal(completed_items)
                update_expression_parts.append('#completedItems = :completedItems')
                expression_attribute_names['#completedItems'] = 'completedItems'
                expression_attribute_values[':completedItems'] = completed_items
                app.logger.info(f"Updating completedItems: {len(completed_items)} item(s)")
            else:
                app.logger.info("completedItems is empty, skipping update")
        
        # Handle notes if provided
        if 'notes' in data:
            update_expression_parts.append('#notes = :notes')
            expression_attribute_names['#notes'] = 'notes'
            expression_attribute_values[':notes'] = data['notes']
        
        # Handle implementationPlan if provided
        if 'implementationPlan' in data:
            update_expression_parts.append('#implementationPlan = :implementationPlan')
            expression_attribute_names['#implementationPlan'] = 'implementationPlan'
            expression_attribute_values[':implementationPlan'] = data['implementationPlan']
        
        update_expression = 'SET ' + ', '.join(update_expression_parts)
        
        app.logger.info(f"Update expression: {update_expression}")
        app.logger.info(f"Updating fields: {list(expression_attribute_names.values())}")
        
        # Use update_item instead of put_item for partial updates
        response = dynamodb_table.update_item(
            Key={'workloadId': workload_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values,
            ReturnValues='ALL_NEW'
        )
        
        app.logger.info(f"Successfully updated DynamoDB")
        
        # Convert response to JSON-serializable format
        updated_item = decimal_to_float(response['Attributes'])
        
        return jsonify({'success': True, 'item': updated_item})
    
    except ClientError as e:
        app.logger.error(f"Error saving prioritization for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to save prioritization data'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error saving prioritization: {str(e)}")
        app.logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/prioritizations/<workload_id>/notes', methods=['POST'])
@require_auth
def update_notes(workload_id):
    """Update notes in WAFR Tool"""
    try:
        data = request.json
        question_id = data.get('questionId')
        lens_alias = data.get('lensAlias', 'wellarchitected')
        notes = data.get('notes', '')
        
        if not question_id:
            return jsonify({'error': 'questionId is required'}), 400
        
        # Update answer with notes
        wellarchitected.update_answer(
            WorkloadId=workload_id,
            LensAlias=lens_alias,
            QuestionId=question_id,
            Notes=notes
        )
        
        return jsonify({'success': True})
    
    except ClientError as e:
        app.logger.error(f"Error updating notes for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to update notes'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error updating notes: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

@app.route('/api/workloads/<workload_id>/answers/<question_id>', methods=['GET', 'PUT', 'OPTIONS'])
@require_auth
def handle_answer(workload_id, question_id):
    """Handle answer operations — GET, PUT, and OPTIONS preflight"""
    if request.method == 'OPTIONS':
        return '', 200
    elif request.method == 'GET':
        return get_answer(workload_id, question_id)
    elif request.method == 'PUT':
        return update_answer(workload_id, question_id)

def get_answer(workload_id, question_id):
    """Get a single answer"""
    try:
        lens_alias = request.args.get('lensAlias', 'wellarchitected')
        
        response = wellarchitected.get_answer(
            WorkloadId=workload_id,
            LensAlias=lens_alias,
            QuestionId=question_id
        )
        
        answer = response.get('Answer', {})
        
        return jsonify({
            'answer': {
                'questionId': answer.get('QuestionId'),
                'pillarId': answer.get('PillarId'),
                'questionTitle': answer.get('QuestionTitle'),
                'selectedChoices': answer.get('SelectedChoices', []),
                'choices': answer.get('Choices', []),
                'isApplicable': answer.get('IsApplicable', True),
                'risk': answer.get('Risk'),
                'notes': answer.get('Notes'),
                'reason': answer.get('Reason')
            }
        })
    except ClientError as e:
        app.logger.error(f"Error getting answer {question_id} for {workload_id}: {str(e)}")
        return jsonify({'error': 'Failed to get answer'}), 500

def update_answer(workload_id, question_id):
    """Update answer choices in WAFR Tool (called by handle_answer for PUT requests).

    Two modes controlled by the replaceMode flag in the request body:

    Merge mode (default, replaceMode=False):
        Fetches the current selections from AWS and unions them with the incoming
        choices. This is used when completing a finding — we want to ADD the newly
        implemented best practices without accidentally clearing anything the customer
        already had selected. "None of these" choices are stripped from the merged
        set because they can't coexist with real selections.

    Replace mode (replaceMode=True):
        Ignores existing selections and uses only the provided choices. Used when
        resetting a question back to its pre-completion state. If the provided list
        is empty and no "none" choice is available, the question is left blank rather
        than silently keeping stale selections.
    """
    try:
        data = request.json
        lens_alias = data.get('lensAlias', 'wellarchitected')
        selected_choices = data.get('selectedChoices', [])
        notes = data.get('notes', '')
        is_applicable = data.get('isApplicable', True)
        reason = data.get('reason')
        replace_mode = data.get('replaceMode', False)  # If true, replace all choices instead of merging
        
        app.logger.debug(f"UPDATE ANSWER: {workload_id}/{question_id} lens={lens_alias} choices={selected_choices}")  # nosemgrep: tainted-sql-string
        
        # Fetch current answer to merge with or validate against existing selections
        currently_selected = []
        available_choices = []
        try:
            current_answer = wellarchitected.get_answer(
                WorkloadId=workload_id,
                LensAlias=lens_alias,
                QuestionId=question_id
            )
            currently_selected = current_answer.get('Answer', {}).get('SelectedChoices', [])
            available_choices = current_answer.get('Answer', {}).get('Choices', [])
            app.logger.debug(f"Current selections for {question_id}: {currently_selected} ({len(available_choices)} choices available)")
        except Exception as e:
            app.logger.warning(f"Could not get current answer for {question_id}: {str(e)}")
        
        if replace_mode:
            app.logger.debug(f"REPLACE MODE for {question_id}: using only provided choices")
            merged_choices = list(selected_choices)
            # If empty, select the "none of these" choice so the question isn't left blank
            if not merged_choices and available_choices:
                for choice in available_choices:
                    cid = choice.get('ChoiceId', '').lower()
                    title = choice.get('Title', '').lower()
                    if cid.endswith('_no') or 'none of' in title or 'not applicable' in title:
                        merged_choices = [choice.get('ChoiceId')]
                        app.logger.debug(f"Empty selection — using 'none' choice: {merged_choices}")
                        break
        else:
            # Merge current selections with new selections (deduplicate)
            merged_choices = list(set(currently_selected + selected_choices))
        
        # Validate: only include choices that actually exist for this question
        valid_choice_ids = [c.get('ChoiceId') for c in available_choices] if available_choices else []
        if valid_choice_ids:
            invalid_choices = [c for c in merged_choices if c not in valid_choice_ids]
            if invalid_choices:
                app.logger.warning(f"Removing invalid choice IDs for {question_id}: {invalid_choices}")
            merged_choices = [c for c in merged_choices if c in valid_choice_ids]
        
        # Remove "none of these" choices — can't be selected alongside real choices
        # Skip this in replace mode since we may intentionally want "none of these"
        if not replace_mode:
            none_choices = []
            for choice in available_choices:
                cid = choice.get('ChoiceId', '').lower()
                title = choice.get('Title', '').lower()
                if cid.endswith('_no') or 'none of' in title or 'not applicable' in title:
                    none_choices.append(choice.get('ChoiceId'))
            
            if none_choices:
                before_count = len(merged_choices)
                merged_choices = [c for c in merged_choices if c not in none_choices]
                if len(merged_choices) < before_count:
                    app.logger.debug(f"Removed 'none of these' choices for {question_id}: {none_choices}")
        
        app.logger.debug(f"Final merged choices for {question_id}: {merged_choices}")
        
        # Build update parameters
        choice_updates = {}
        
        if replace_mode and available_choices:
            # In replace mode, only mark selected choices — don't mark others as NOT_APPLICABLE
            for choice in available_choices:
                cid = choice.get('ChoiceId')
                if cid in merged_choices:
                    choice_updates[cid] = {'Status': 'SELECTED'}
        else:
            for choice_id in merged_choices:
                choice_updates[choice_id] = {'Status': 'SELECTED'}
        
        update_params = {
            'WorkloadId': workload_id,
            'LensAlias': lens_alias,
            'QuestionId': question_id,
            'SelectedChoices': merged_choices,
            'ChoiceUpdates': choice_updates,
            'IsApplicable': is_applicable
        }
        
        if notes:
            update_params['Notes'] = notes
        
        if reason:
            update_params['Reason'] = reason
        
        app.logger.debug(
            f"Calling AWS update_answer: workload={workload_id} lens={lens_alias} "
            f"question={question_id} choices={merged_choices} applicable={is_applicable}"
        )
        
        # Update answer
        response = wellarchitected.update_answer(**update_params)
        
        app.logger.debug(
            f"AWS update_answer response: question={response.get('QuestionId')} "
            f"selected={response.get('Answer', {}).get('SelectedChoices', [])}"
        )
        
        # Return the response from AWS so we can see what actually happened
        return jsonify({
            'success': True,
            'awsResponse': {
                'questionId': response.get('QuestionId'),
                'selectedChoices': response.get('Answer', {}).get('SelectedChoices', []),
                'isApplicable': response.get('Answer', {}).get('IsApplicable'),
                'lensAlias': response.get('LensAlias')
            }
        })
    
    except ClientError as e:
        app.logger.error(f"Error updating answer for {workload_id}/{question_id}: {str(e)}")
        return jsonify({'error': 'Failed to update answer'}), 500
    except Exception as e:
        app.logger.error(f"Unexpected error updating answer: {str(e)}")
        return jsonify({'error': 'An unexpected error occurred'}), 500

# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/auth/verify', methods=['GET'])
def verify_credentials():
    """Verify AWS credentials"""
    try:
        sts = boto3.client('sts')
        identity = sts.get_caller_identity()
        
        return jsonify({
            'authenticated': True,
            'account': identity['Account'],
            'arn': identity['Arn'],
            'userId': identity['UserId']
        })
    
    except ClientError as e:
        app.logger.error(f"AWS credential verification failed: {str(e)}")
        return jsonify({
            'authenticated': False,
            'error': 'Invalid or expired AWS credentials'
        }), 401
    except Exception as e:
        app.logger.error(f"Unexpected error verifying credentials: {str(e)}")
        return jsonify({
            'authenticated': False,
            'error': 'Authentication failed'
        }), 401

# ============================================================================
# BEDROCK HELPERS
# ============================================================================

# pillar ordering order for URL enrichment
PILLAR_ORDERING = [
    'Security', 'Reliability', 'Performance Efficiency',
    'Operational Excellence', 'Cost Optimization', 'Sustainability'
]

def _fetch_url_text(url, max_chars=12000):
    """Fetch a URL and extract text content, handling #step fragment URLs.

    For URLs with a #step fragment (e.g. wa.aws.amazon.com/...#step2):
    - Returns a dict with 'overview' (top of page) and 'step' (specific step content)
    For regular URLs:
    - Returns the full page text as a string
    Returns empty string on any failure.
    """
    try:
        # Parse fragment and fetch the base URL
        fragment = ''
        fetch_url = url
        if '#' in url:
            fetch_url, fragment = url.rsplit('#', 1)

        resp = http_requests.get(fetch_url, timeout=10, headers={
            'User-Agent': 'WASP/1.0 (Well-Architected Summary Producer)'
        })
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        # Remove nav, header, footer, script, style elements
        for tag in soup.find_all(['nav', 'header', 'footer', 'script', 'style', 'aside']):
            tag.decompose()

        main = soup.find('main') or soup.find('article') or soup.find('div', {'id': 'main-content'}) or soup.find('div', {'role': 'main'}) or soup.body or soup

        # If there's a step fragment, extract the overview and specific step separately
        if fragment and fragment.startswith('step'):
            # Extract the overview: everything before the first step/section
            overview_parts = []
            step_content = ''

            # Find the target step element by ID
            step_el = main.find(id=fragment)

            # Gather overview text: page title, description, intro before steps
            # Typically the h1/h2 and first few paragraphs before the steps list
            for child in main.children:
                if hasattr(child, 'get') and child.get('id', '').startswith('step'):
                    break
                text = child.get_text(separator='\n', strip=True) if hasattr(child, 'get_text') else str(child).strip()
                if text:
                    overview_parts.append(text)

            overview = '\n'.join(overview_parts)
            if len(overview) > max_chars // 2:
                overview = overview[:max_chars // 2] + '... [truncated]'

            # Extract the specific step content
            if step_el:
                # Get the step element and its siblings until the next step
                step_parts = [step_el.get_text(separator='\n', strip=True)]
                for sibling in step_el.find_next_siblings():
                    if hasattr(sibling, 'get') and sibling.get('id', '').startswith('step'):
                        break
                    step_parts.append(sibling.get_text(separator='\n', strip=True))
                step_content = '\n'.join(step_parts)
                if len(step_content) > max_chars // 2:
                    step_content = step_content[:max_chars // 2] + '... [truncated]'

            if overview or step_content:
                return {'overview': overview, 'step': step_content, 'fragment': fragment}

        # Regular URL: return full page text
        text = main.get_text(separator='\n', strip=True)
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        text = '\n'.join(lines)
        if len(text) > max_chars:
            text = text[:max_chars] + '... [truncated]'
        return text
    except Exception as e:
        app.logger.warning(f"Failed to fetch {url}: {e}")
        return ''

def _summarise_text(page_content, best_practice_title, pillar, risk, model_id):
    """Use Bedrock to summarise page content into a short paragraph.

    Handles two content formats:
    - dict with 'overview' and 'step' keys (step-based URLs with # fragments)
    - plain string (regular full-page URLs)
    """
    try:
        if isinstance(page_content, dict) and 'step' in page_content:
            # Step-based content: use the step-specific prompt
            prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'summarise_resource_step.txt')
            with open(prompt_path, 'r', encoding='utf-8') as f:
                prompt_template = f.read()
            prompt = prompt_template.format(
                best_practice_title=best_practice_title,
                pillar=pillar,
                risk=risk,
                overview_content=page_content.get('overview', ''),
                step_content=page_content.get('step', ''),
            )
        else:
            # Regular full-page content
            prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'summarise_resource.txt')
            with open(prompt_path, 'r', encoding='utf-8') as f:
                prompt_template = f.read()
            prompt = prompt_template.format(
                best_practice_title=best_practice_title,
                pillar=pillar,
                risk=risk,
                page_content=page_content if isinstance(page_content, str) else str(page_content),
            )

        response = bedrock_runtime.converse(
            modelId=model_id,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 400, 'temperature': 0.2}
        )
        return response['output']['message']['content'][0]['text']
    except Exception as e:
        app.logger.warning(f"Failed to summarise '{best_practice_title}': {e}")
        return ''




def _get_cached_summaries(storage_key):
    """Retrieve cached AI summaries from DynamoDB for a workload/lens."""
    try:
        response = dynamodb_table.get_item(Key={'workloadId': storage_key})
        item = response.get('Item', {})
        return item.get('aiSummaries', {})
    except Exception as e:
        app.logger.warning(f"Failed to read cached summaries: {e}")
        return {}


def _save_cached_summaries(storage_key, summaries):
    """Save AI summaries to DynamoDB for a workload/lens."""
    try:
        dynamodb_table.update_item(
            Key={'workloadId': storage_key},
            UpdateExpression='SET #ai = :ai, #aiUpdated = :ts',
            ExpressionAttributeNames={'#ai': 'aiSummaries', '#aiUpdated': 'aiSummariesUpdatedAt'},
            ExpressionAttributeValues={
                ':ai': summaries,
                ':ts': datetime.now().isoformat(),
            }
        )
        app.logger.info(f"Saved {len(summaries)} AI summaries to DynamoDB for {storage_key}")
    except Exception as e:
        app.logger.warning(f"Failed to save cached summaries: {e}")


def _get_cached_business_summary(storage_key):
    """Retrieve cached business summary from DynamoDB for a workload/lens."""
    try:
        response = dynamodb_table.get_item(Key={'workloadId': storage_key})
        item = response.get('Item', {})
        return item.get('businessSummary')
    except Exception as e:
        app.logger.warning(f"Failed to read cached business summary: {e}")
        return None


def _save_cached_business_summary(storage_key, summary, model_id, input_tokens, output_tokens):
    """Save business summary to DynamoDB for a workload/lens."""
    try:
        dynamodb_table.update_item(
            Key={'workloadId': storage_key},
            UpdateExpression='SET #bs = :bs, #bsUpdated = :ts',
            ExpressionAttributeNames={'#bs': 'businessSummary', '#bsUpdated': 'businessSummaryUpdatedAt'},
            ExpressionAttributeValues={
                ':bs': {
                    'summary': summary,
                    'modelId': model_id,
                    'inputTokens': input_tokens,
                    'outputTokens': output_tokens,
                },
                ':ts': datetime.now().isoformat(),
            }
        )
    except Exception as e:
        app.logger.warning(f"Failed to save cached business summary: {e}")




def _enrich_findings_with_urls(findings_summary, model_id, storage_key=None, max_new=20):
    """Fetch and summarise URL content for high and medium risk best practice items.

    Collects URLs in order: HIGH risk first (by pillar ordering), then
    MEDIUM risk (by pillar ordering). All cached summaries are returned regardless
    of the cap. Up to max_new *uncached* URLs are fetched and summarised per call.
    This means if some are already cached, the budget is spent on the next items
    in the ordering queue — potentially reaching medium-risk findings.
    """
    # Load cached summaries
    cached = _get_cached_summaries(storage_key) if storage_key else {}
    app.logger.info(f"Found {len(cached)} cached AI summaries")

    # Collect all unique URLs ordered: HIGH by pillar ordering, then MEDIUM by pillar ordering
    url_queue = []  # ordered list of (url, metadata)
    seen_urls = set()

    for risk_level in ['HIGH', 'MEDIUM']:
        for pillar in PILLAR_ORDERING:
            for f in findings_summary:
                if f.get('risk', '').upper() != risk_level:
                    continue
                if f.get('pillar', '') != pillar:
                    continue
                for bp in f.get('bestPractices', []):
                    if isinstance(bp, str):
                        continue
                    url = (bp.get('helpfulResourceUrl') or '').strip()
                    if url and url.startswith('http') and url not in seen_urls:
                        seen_urls.add(url)
                        url_queue.append((url, {
                            'title': bp.get('title', 'Untitled'),
                            'pillar': pillar,
                            'risk': risk_level,
                        }))

    app.logger.info(f"Found {len(url_queue)} unique URLs (high+medium risk)")

    # Return all cached hits, spend the budget on uncached ones
    enriched = {}
    to_fetch = []
    for url, meta in url_queue:
        if url in cached and cached[url]:
            enriched[url] = cached[url]
        else:
            to_fetch.append((url, meta))

    app.logger.info(f"URL summaries: {len(enriched)} cached, {len(to_fetch)} uncached, fetching up to {max_new}")

    # Fetch and summarise up to max_new uncached URLs
    fetched_count = 0
    for url, meta in to_fetch:
        if fetched_count >= max_new:
            break
        page_text = _fetch_url_text(url)
        if not page_text:
            continue
        text_size = len(page_text) if isinstance(page_text, str) else len(page_text.get('overview', '')) + len(page_text.get('step', ''))
        is_step = isinstance(page_text, dict)
        app.logger.info(f"  Fetched {url}: {text_size} chars{' (step-based)' if is_step else ''}, summarising...")
        summary = _summarise_text(page_text, meta['title'], meta['pillar'], meta['risk'], model_id)
        if summary:
            enriched[url] = summary
            fetched_count += 1
            app.logger.info(f"  Summarised {url}: {len(summary)} chars ({fetched_count}/{max_new})")

    # Save all summaries (cached + new) back to DynamoDB
    if storage_key and enriched:
        _save_cached_summaries(storage_key, enriched)

    remaining = len(to_fetch) - fetched_count
    if remaining > 0:
        app.logger.info(f"{remaining} URLs still unsummarised — will be picked up on next generation")

    return enriched


def _build_findings_text(findings_summary, enriched_urls=None):
    """Build a detailed text representation of findings for use in prompts.

    Findings are sorted by pillar ordering, then high risk before medium risk within each pillar.
    URLs are provided by the frontend in each best practice's helpfulResourceUrl.
    """
    enriched_urls = enriched_urls or {}

    pillar_order = {p: i for i, p in enumerate(PILLAR_ORDERING)}
    risk_order = {'HIGH': 0, 'MEDIUM': 1}
    sorted_findings = sorted(
        findings_summary,
        key=lambda f: (
            pillar_order.get(f.get('pillar', ''), 99),
            risk_order.get(f.get('risk', '').upper(), 99)
        )
    )

    text = ""
    for f in sorted_findings:
        risk = f.get('risk', 'unknown').upper()
        pillar = f.get('pillar', 'Unknown')
        title = f.get('questionTitle', 'Untitled')
        text += f"\n- [{risk}] {pillar}: {title}"

        best_practices = f.get('bestPractices', [])
        if not best_practices:
            text += "\n  Remediation: No specific remediation listed"
            continue

        for bp in best_practices:
            if isinstance(bp, str):
                text += f"\n  - {bp}"
                continue

            bp_title = bp.get('title', 'Untitled')
            text += f"\n  - Best Practice: {bp_title}"

            description = bp.get('description', '').strip()
            if description:
                text += f"\n    Description: {description}"

            improvement = bp.get('improvementPlan', '').strip()
            if improvement:
                text += f"\n    Improvement Plan: {improvement}"

            url = (bp.get('helpfulResourceUrl') or '').strip()
            if url:
                text += f"\n    Reference: {url}"
                summary = enriched_urls.get(url)
                if summary:
                    text += f"\n    --- Summarised Guidance ---\n    {summary}\n    --- End Summarised Guidance ---"

    return text

# ============================================================================
# BEDROCK MODELS
# ============================================================================



@app.route('/api/bedrock/models', methods=['GET'])
@require_auth
def list_bedrock_models():
    """List available Bedrock on-demand models in the deployment region.

    Uses list_foundation_models to get models available in this region, filtered to
    text-capable models only. Excludes models that are end-of-life, non-text,
    or require data retention opt-in.
    """
    try:
        models = []

        excluded_models = [
            'claude-3-opus',
            'claude-3-sonnet-2024',
            'claude-3-haiku-2024',
            'claude-3-5-sonnet-2024',
            'claude-3-7-sonnet',
            'claude-sonnet-4-20250514',
            'claude-opus-4-1',
            'claude-opus-5',
            'claude-v2',
            'claude-instant',
            'jamba-1-5',
            'command-r-v1',
            'command-r-plus-v1',
            'nova-canvas', 'nova-reel', 'nova-sonic', 'nova-premier',
            'llama3-2-11b', 'llama3-2-1b', 'llama3-2-3b', 'llama3-2-90b',
            'llama3-1-8b', 'llama3-1-70b',
            'stable-diffusion', 'stability.',
            'titan-image', 'titan-embed',
            'cohere.embed',
            'marengo-embed',
            'twelvelabs',
            'claude-fable',
            'claude-sonnet-5',
            'claude-opus-4-7',
            'claude-opus-4-8',
        ]

        def _is_excluded(model_id):
            lower_id = model_id.lower()
            for pattern in excluded_models:
                if pattern in lower_id:
                    return True
            return False

        response = bedrock.list_foundation_models(byInferenceType='ON_DEMAND', byOutputModality='TEXT')
        for model in response.get('modelSummaries', []):
            lifecycle = model.get('modelLifecycle', {})
            if lifecycle.get('status') in ('LEGACY', 'EOL'):
                continue
            model_id = model['modelId']
            if _is_excluded(model_id):
                continue
            if 'TEXT' not in model.get('inputModalities', []):
                continue
            models.append({
                'modelId': model_id,
                'modelName': model.get('modelName', model_id),
                'providerName': model.get('providerName', 'Unknown'),
                'type': 'foundation-model',
            })

        models.sort(key=lambda m: (m['providerName'], m['modelName']))
        return jsonify({'models': models})

    except Exception as e:
        app.logger.error(f"Error listing Bedrock models: {type(e).__name__}: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({
            'error': f'Failed to list Bedrock models: {type(e).__name__}',
            'details': str(e)
        }), 500



@app.route('/api/bedrock/generate-summary', methods=['POST'])
@require_auth
def generate_business_summary():
    """Generate a business summary of the Well-Architected review using a Bedrock model.

    If regenerate=false (default) and a cached summary exists, returns the cached version.
    If regenerate=true, generates a fresh summary and overwrites the cache.
    """
    try:
        data = request.get_json()
        model_id = data.get('modelId')
        workload_context = data.get('workloadContext', {})
        findings_summary = data.get('findingsSummary', [])
        storage_key = data.get('storageKey')
        regenerate = data.get('regenerate', False)

        if not model_id:
            return jsonify({'error': 'modelId is required'}), 400

        # Check cache first (unless regenerating)
        if not regenerate and storage_key:
            cached = _get_cached_business_summary(storage_key)
            if cached:
                # Still enrich URLs (uses its own cache) so ImprovementPlan gets summaries
                enriched_urls = _enrich_findings_with_urls(findings_summary, model_id=model_id, storage_key=storage_key)
                return jsonify({
                    'summary': cached['summary'],
                    'modelId': cached.get('modelId', model_id),
                    'inputTokens': cached.get('inputTokens', 0),
                    'outputTokens': cached.get('outputTokens', 0),
                    'aiSummaries': enriched_urls,
                    'fromCache': True,
                })

        # Build findings text from structured data, enriched with fetched URL content
        enriched_urls = _enrich_findings_with_urls(findings_summary, model_id=model_id, storage_key=storage_key)
        findings_text = _build_findings_text(findings_summary, enriched_urls=enriched_urls)

        # Load prompt template from file (re-read each time so edits take effect without restart)
        prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'business_summary.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            workload_name=workload_context.get('workloadName', 'Unknown'),
            description=workload_context.get('description', 'No description provided'),
            environment=workload_context.get('environment', 'Unknown'),
            industry=workload_context.get('industryType') or workload_context.get('industry', ''),
            regions=', '.join(workload_context.get('awsRegions', [])) or 'Not specified',
            lens_name=workload_context.get('lensName', 'Well-Architected'),
            high_count=workload_context.get('highRiskCount', 0),
            medium_count=workload_context.get('mediumRiskCount', 0),
            findings_text=findings_text,
        )

        response = bedrock_runtime.converse(
            modelId=model_id,
            messages=[{
                'role': 'user',
                'content': [{'text': prompt}]
            }],
            inferenceConfig={
                'maxTokens': 4096,
                'temperature': 0.3,
            }
        )

        output_text = response['output']['message']['content'][0]['text']
        input_tokens = response.get('usage', {}).get('inputTokens', 0)
        output_tokens = response.get('usage', {}).get('outputTokens', 0)

        # Cache the business summary
        if storage_key:
            app.logger.info(f"Saving business summary to {storage_key}")
            _save_cached_business_summary(storage_key, output_text, model_id, input_tokens, output_tokens)

        return jsonify({
            'summary': output_text,
            'modelId': model_id,
            'inputTokens': input_tokens,
            'outputTokens': output_tokens,
            'aiSummaries': enriched_urls,
            'fromCache': False,
        })

    except ClientError as e:
        error_code = e.response['Error']['Code']
        app.logger.error(f"Bedrock generate error: {error_code} - {str(e)}")
        return jsonify({
            'error': f'Failed to generate summary: {error_code}',
            'details': str(e)
        }), 500
    except Exception as e:
        app.logger.error(f"Error generating summary: {type(e).__name__}: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({
            'error': 'Failed to generate summary',
            'details': str(e)
        }), 500

@app.route('/api/bedrock/ai-summaries/<storage_key>', methods=['GET'])
@require_auth
def get_ai_summaries(storage_key):
    """Retrieve cached AI summaries and business summary for a workload/lens from DynamoDB."""
    try:
        response = dynamodb_table.get_item(Key={'workloadId': storage_key})
        item = response.get('Item', {})
        result = {
            'aiSummaries': item.get('aiSummaries', {}),
        }
        bs = item.get('businessSummary')
        if bs:
            result['businessSummary'] = decimal_to_float(bs)
        return jsonify(result)
    except Exception as e:
        app.logger.error(f"Error getting AI summaries: {str(e)}")
        return jsonify({'error': 'Failed to retrieve AI summaries'}), 500




@app.route('/api/bedrock/ask', methods=['POST'])
@require_auth
def ask_summary_question():
    """Answer a follow-up question about the business summary using a Bedrock model."""
    try:
        data = request.get_json()
        model_id = data.get('modelId')
        question = data.get('question', '').strip()
        business_summary = data.get('businessSummary', '')
        workload_context = data.get('workloadContext', {})
        findings_summary = data.get('findingsSummary', [])

        if not model_id:
            return jsonify({'error': 'modelId is required'}), 400
        if not question:
            return jsonify({'error': 'question is required'}), 400

        # Build findings text
        findings_text = _build_findings_text(findings_summary)

        # Load Q&A prompt template
        prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'business_summary_qa.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        system_prompt = prompt_template.format(
            workload_name=workload_context.get('workloadName', 'Unknown'),
            environment=workload_context.get('environment', 'Unknown'),
            lens_name=workload_context.get('lensName', 'Well-Architected'),
            business_summary=business_summary,
            findings_text=findings_text,
        )

        response = bedrock_runtime.converse(
            modelId=model_id,
            system=[{'text': system_prompt}],
            messages=[{
                'role': 'user',
                'content': [{'text': question}]
            }],
            inferenceConfig={
                'maxTokens': 1024,
                'temperature': 0.3,
            }
        )

        output_text = response['output']['message']['content'][0]['text']

        return jsonify({
            'answer': output_text,
            'modelId': model_id,
            'inputTokens': response.get('usage', {}).get('inputTokens', 0),
            'outputTokens': response.get('usage', {}).get('outputTokens', 0),
        })

    except ClientError as e:
        error_code = e.response['Error']['Code']
        app.logger.error(f"Bedrock ask error: {error_code} - {str(e)}")
        return jsonify({
            'error': f'Failed to answer question: {error_code}',
            'details': str(e)
        }), 500
    except Exception as e:
        app.logger.error(f"Error answering question: {type(e).__name__}: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({
            'error': 'Failed to answer question',
            'details': str(e)
        }), 500


@app.route('/api/bedrock/recommend-positions', methods=['POST'])
@require_auth
def recommend_positions():
    """Use AI to recommend Eisenhower matrix positions for all findings."""
    try:
        data = request.get_json()
        model_id = data.get('modelId')
        business_summary = data.get('businessSummary', '')
        findings_list = data.get('findings', [])

        if not model_id:
            return jsonify({'error': 'modelId is required'}), 400

        # Build findings text with numbered indices for reliable matching
        findings_text = ""
        for i, f in enumerate(findings_list):
            risk = f.get('risk', 'unknown').upper()
            pillar = f.get('pillar', 'Unknown')
            title = f.get('questionTitle', 'Untitled')
            qid = f.get('questionId', '')
            summary = f.get('aiSummary', '')
            findings_text += f"\n#{i+1} [{risk}] {pillar} (id={qid}): {title}"
            if summary:
                findings_text += f"\n  Summary: {summary}"
            bps = f.get('bestPractices', [])
            if bps:
                bp_titles = [bp.get('title', '') for bp in bps if isinstance(bp, dict) and bp.get('title')]
                if bp_titles:
                    findings_text += f"\n  Remediation items: {'; '.join(bp_titles)}"

        prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'recommend_positions.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        prompt = prompt_template.format(
            business_summary=business_summary,
            findings_text=findings_text,
        )

        response = bedrock_runtime.converse(
            modelId=model_id,
            messages=[{'role': 'user', 'content': [{'text': prompt}]}],
            inferenceConfig={'maxTokens': 8192, 'temperature': 0.05}
        )

        output_text = response['output']['message']['content'][0]['text']
        stop_reason = response.get('stopReason', 'unknown')
        app.logger.debug(f"Recommend positions: stopReason={stop_reason}, output length={len(output_text)}")

        # Parse JSON from response — handle markdown code blocks and truncation
        json_text = output_text.strip()
        
        # Strip markdown code fences if present
        if '```' in json_text:
            # Find the JSON array between code fences
            import re as _re
            code_match = _re.search(r'```(?:json)?\s*\n?(.*?)```', json_text, _re.DOTALL)
            if code_match:
                json_text = code_match.group(1).strip()
            else:
                # Incomplete code fence (truncated) — strip the opening fence
                json_text = _re.sub(r'^```(?:json)?\s*\n?', '', json_text).strip()

        # If still no valid JSON start, try to find the array
        if not json_text.startswith('['):
            bracket_pos = json_text.find('[')
            if bracket_pos >= 0:
                json_text = json_text[bracket_pos:]

        # Handle truncated output — close the array at the last complete object
        if json_text and not json_text.endswith(']'):
            last_brace = json_text.rfind('}')
            if last_brace > 0:
                json_text = json_text[:last_brace + 1] + ']'
                app.logger.warning(f"Salvaged truncated JSON, cut at position {last_brace}")

        positions = json.loads(json_text)
        app.logger.info(f"Parsed {len(positions)} positions for {len(findings_list)} findings")

        return jsonify({
            'positions': positions,
            'modelId': model_id,
            'inputTokens': response.get('usage', {}).get('inputTokens', 0),
            'outputTokens': response.get('usage', {}).get('outputTokens', 0),
        })

    except json.JSONDecodeError as e:
        app.logger.error(f"Failed to parse AI position response: {e}")
        return jsonify({'error': 'AI returned invalid JSON', 'details': str(e)}), 500
    except ClientError as e:
        error_code = e.response['Error']['Code']
        return jsonify({'error': f'Failed to recommend positions: {error_code}', 'details': str(e)}), 500
    except Exception as e:
        app.logger.error(f"Error recommending positions: {type(e).__name__}: {str(e)}")
        app.logger.error(traceback.format_exc())
        return jsonify({'error': 'Failed to recommend positions', 'details': str(e)}), 500


@app.route('/api/bedrock/ask-positions', methods=['POST'])
@require_auth
def ask_positions_question():
    """Answer a follow-up question about the AI-recommended positions."""
    try:
        data = request.get_json()
        model_id = data.get('modelId')
        question = data.get('question', '').strip()
        business_summary = data.get('businessSummary', '')
        position_reasons = data.get('positionReasons', '')

        if not model_id:
            return jsonify({'error': 'modelId is required'}), 400
        if not question:
            return jsonify({'error': 'question is required'}), 400

        prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'positions_qa.txt')
        with open(prompt_path, 'r', encoding='utf-8') as f:
            prompt_template = f.read()

        system_prompt = prompt_template.format(
            business_summary=business_summary,
            position_reasons=position_reasons,
        )

        response = bedrock_runtime.converse(
            modelId=model_id,
            system=[{'text': system_prompt}],
            messages=[{'role': 'user', 'content': [{'text': question}]}],
            inferenceConfig={'maxTokens': 1024, 'temperature': 0.3}
        )

        output_text = response['output']['message']['content'][0]['text']

        return jsonify({
            'answer': output_text,
            'modelId': model_id,
            'inputTokens': response.get('usage', {}).get('inputTokens', 0),
            'outputTokens': response.get('usage', {}).get('outputTokens', 0),
        })

    except ClientError as e:
        error_code = e.response['Error']['Code']
        return jsonify({'error': f'Failed to answer question: {error_code}', 'details': str(e)}), 500
    except Exception as e:
        app.logger.error(f"Error answering positions question: {type(e).__name__}: {str(e)}")
        return jsonify({'error': 'Failed to answer question', 'details': str(e)}), 500






if __name__ == '__main__':
    init_aws_clients()
    app.run(host='127.0.0.1', port=5001)
