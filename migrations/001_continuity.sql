CREATE SCHEMA IF NOT EXISTS continuity AUTHORIZATION continuity_owner;

CREATE TABLE IF NOT EXISTS continuity.authorization_grants (
  namespace_id text NOT NULL, authorization_grant_id text NOT NULL, case_id text NOT NULL,
  actor_id text NOT NULL, version bigint NOT NULL CHECK (version >= 0), is_revoked boolean NOT NULL,
  PRIMARY KEY (namespace_id, authorization_grant_id)
);
CREATE TABLE IF NOT EXISTS continuity.cases (
  namespace_id text NOT NULL, case_id text NOT NULL, owner_agent_id text NOT NULL,
  version bigint NOT NULL CHECK (version >= 0), status text NOT NULL,
  commitment_deadline timestamptz, commitment_status text, payload_ref text,
  PRIMARY KEY (namespace_id, case_id)
);
CREATE TABLE IF NOT EXISTS continuity.command_receipts (
  namespace_id text NOT NULL, command_id text NOT NULL, case_id text NOT NULL, request_hash text NOT NULL,
  outcome_status text NOT NULL, decision_code text NOT NULL, authorization_version text NOT NULL,
  case_version bigint NOT NULL, world_time timestamptz NOT NULL, ingestion_time timestamptz NOT NULL,
  payload_ref text, projection_schema_version integer NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY (namespace_id, command_id)
);
CREATE TABLE IF NOT EXISTS continuity.accepted_history (
  namespace_id text NOT NULL, case_id text NOT NULL, position bigint NOT NULL, command_id text NOT NULL,
  request_hash text NOT NULL, actor_id text NOT NULL, authorization_grant_id text NOT NULL,
  authorization_version bigint NOT NULL, validator_version integer NOT NULL, action_type text NOT NULL,
  world_time timestamptz NOT NULL, ingestion_time timestamptz NOT NULL, payload_ref text,
  PRIMARY KEY (namespace_id, case_id, position), UNIQUE (namespace_id, command_id)
);
CREATE TABLE IF NOT EXISTS continuity.decision_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, namespace_id text NOT NULL,
  command_id text NOT NULL, case_id text NOT NULL, request_hash text NOT NULL, actor_id text NOT NULL,
  authorization_grant_id text NOT NULL, authorization_version text NOT NULL,
  validator_version integer NOT NULL, decision_code text NOT NULL,
  world_time timestamptz NOT NULL, ingestion_time timestamptz NOT NULL, payload_ref text
);

CREATE OR REPLACE FUNCTION continuity.commit_command(
  p_command_id text, p_request_hash text, p_request jsonb,
  p_validator_version integer, p_projection_schema_version integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_namespace text := p_request->>'namespaceId'; v_case_id text := p_request->>'caseId';
  v_actor text := p_request->>'actorId'; v_grant_id text := p_request->>'authorizationGrantId';
  v_auth_version text := p_request->>'authorizationVersion'; v_expected_version text := p_request->>'expectedCaseVersion';
  v_action text := p_request->>'actionType'; v_payload_ref text := p_request->'actionPayload'->>'payloadRef';
  v_deadline text := p_request->'actionPayload'->>'commitmentDeadline'; v_resolution text := p_request->'actionPayload'->>'resolution';
  v_world_time timestamptz := (p_request->>'worldTime')::timestamptz; v_ingestion_time timestamptz := pg_catalog.clock_timestamp();
  v_receipt continuity.command_receipts%ROWTYPE; v_grant continuity.authorization_grants%ROWTYPE;
  v_case continuity.cases%ROWTYPE; v_code text; v_result jsonb; v_projection jsonb; v_new_version bigint;
BEGIN
  IF pg_catalog.current_setting('continuity.test_failpoint', true) = 'retry_forever' THEN RAISE EXCEPTION USING ERRCODE='40001'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.length(v_namespace)::text || ':' || v_namespace || p_command_id, 0));
  SELECT * INTO v_receipt FROM continuity.command_receipts
    WHERE namespace_id = v_namespace AND command_id = p_command_id;
  IF FOUND THEN
    IF v_receipt.request_hash = p_request_hash THEN RETURN v_receipt.result; END IF;
    v_result := pg_catalog.jsonb_build_object('status','rejected','code','IDEMPOTENCY_KEY_REUSED','namespaceId',v_namespace,
      'caseId',v_case_id,'commandId',p_command_id,'requestHash',p_request_hash,'authorizationVersion',v_auth_version,
      'caseVersion',v_expected_version,'payloadRef',v_payload_ref);
    INSERT INTO continuity.decision_audit (namespace_id,command_id,case_id,request_hash,actor_id,authorization_grant_id,
      authorization_version,validator_version,decision_code,world_time,ingestion_time,payload_ref)
      VALUES (v_namespace,p_command_id,v_case_id,p_request_hash,v_actor,v_grant_id,v_auth_version,p_validator_version,
        'IDEMPOTENCY_KEY_REUSED',v_world_time,v_ingestion_time,v_payload_ref);
    RETURN v_result;
  END IF;
  IF p_request->'requestHashSchemaVersion' IS DISTINCT FROM '1'::jsonb THEN v_code := 'UNSUPPORTED_REQUEST_HASH_SCHEMA_VERSION';
  ELSIF p_validator_version IS DISTINCT FROM 1 THEN v_code := 'UNSUPPORTED_VALIDATOR_VERSION';
  ELSIF p_projection_schema_version IS DISTINCT FROM 1 THEN v_code := 'UNSUPPORTED_PROJECTION_SCHEMA_VERSION';
  ELSIF v_action IS DISTINCT FROM 'resolve_case' THEN v_code := 'UNSUPPORTED_ACTION_TYPE';
  ELSIF v_resolution IS NULL OR v_resolution NOT IN ('completed','cancelled') OR v_deadline IS NULL OR v_payload_ref IS NULL THEN v_code := 'INVALID_ACTION_PAYLOAD';
  ELSE
    SELECT * INTO v_grant FROM continuity.authorization_grants
      WHERE namespace_id = v_namespace AND authorization_grant_id = v_grant_id FOR UPDATE;
    IF NOT FOUND OR v_grant.case_id IS DISTINCT FROM v_case_id OR v_grant.actor_id IS DISTINCT FROM v_actor THEN v_code := 'AUTHORIZATION_DENIED';
    ELSIF v_grant.is_revoked THEN v_code := 'AUTHORIZATION_REVOKED';
    ELSIF v_grant.version::text IS DISTINCT FROM v_auth_version THEN v_code := 'AUTHORIZATION_VERSION_CONFLICT';
    ELSE
      SELECT * INTO v_case FROM continuity.cases
        WHERE namespace_id = v_namespace AND case_id = v_case_id FOR UPDATE;
      IF NOT FOUND OR v_case.owner_agent_id IS DISTINCT FROM v_actor THEN v_code := 'AUTHORIZATION_DENIED';
      ELSIF v_case.version::text IS DISTINCT FROM v_expected_version OR v_case.status <> 'open' THEN v_code := 'EXPECTED_VERSION_CONFLICT';
      END IF;
    END IF;
  END IF;
  IF v_code IS NOT NULL THEN
    v_result := pg_catalog.jsonb_build_object('status','rejected','code',v_code,'namespaceId',v_namespace,'caseId',v_case_id,
      'commandId',p_command_id,'requestHash',p_request_hash,'authorizationVersion',v_auth_version,
      'caseVersion',COALESCE(v_case.version::text,v_expected_version),'payloadRef',v_payload_ref);
    INSERT INTO continuity.command_receipts (namespace_id,command_id,case_id,request_hash,outcome_status,decision_code,
      authorization_version,case_version,world_time,ingestion_time,payload_ref,projection_schema_version,result)
      VALUES (v_namespace,p_command_id,v_case_id,p_request_hash,'rejected',v_code,v_auth_version,
        COALESCE(v_case.version::text,v_expected_version)::bigint,v_world_time,v_ingestion_time,v_payload_ref,p_projection_schema_version,v_result);
    INSERT INTO continuity.decision_audit (namespace_id,command_id,case_id,request_hash,actor_id,authorization_grant_id,
      authorization_version,validator_version,decision_code,world_time,ingestion_time,payload_ref)
      VALUES (v_namespace,p_command_id,v_case_id,p_request_hash,v_actor,v_grant_id,v_auth_version,p_validator_version,
        v_code,v_world_time,v_ingestion_time,v_payload_ref);
    RETURN v_result;
  END IF;
  v_new_version := v_case.version + 1;
  UPDATE continuity.cases SET version=v_new_version,status='resolved',commitment_deadline=v_deadline::timestamptz,
    commitment_status=v_resolution,payload_ref=v_payload_ref WHERE namespace_id=v_namespace AND case_id=v_case_id;
  IF pg_catalog.current_setting('continuity.test_failpoint', true) = 'after_write' THEN PERFORM pg_catalog.pg_sleep(30); END IF;
  v_projection := pg_catalog.jsonb_build_object('projectionSchemaVersion',p_projection_schema_version,'namespaceId',v_namespace,
    'case',pg_catalog.jsonb_build_object('caseId',v_case_id,'ownerAgentId',v_case.owner_agent_id,'version',v_new_version::text,
      'status','resolved','commitment',pg_catalog.jsonb_build_object('deadline',v_deadline,'status',v_resolution)));
  v_result := pg_catalog.jsonb_build_object('status','accepted','code','ACCEPTED','namespaceId',v_namespace,'caseId',v_case_id,
    'commandId',p_command_id,'requestHash',p_request_hash,'authorizationVersion',v_auth_version,'caseVersion',v_new_version::text,
    'payloadRef',v_payload_ref,'projectionSchemaVersion',p_projection_schema_version,'projection',v_projection);
  INSERT INTO continuity.accepted_history (namespace_id,case_id,position,command_id,request_hash,actor_id,
    authorization_grant_id,authorization_version,validator_version,action_type,world_time,ingestion_time,payload_ref)
    VALUES (v_namespace,v_case_id,v_new_version,p_command_id,p_request_hash,v_actor,v_grant_id,v_grant.version,
      p_validator_version,v_action,v_world_time,v_ingestion_time,v_payload_ref);
  INSERT INTO continuity.command_receipts (namespace_id,command_id,case_id,request_hash,outcome_status,decision_code,
    authorization_version,case_version,world_time,ingestion_time,payload_ref,projection_schema_version,result)
    VALUES (v_namespace,p_command_id,v_case_id,p_request_hash,'accepted','ACCEPTED',v_auth_version,v_new_version,
      v_world_time,v_ingestion_time,v_payload_ref,p_projection_schema_version,v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON SCHEMA continuity FROM PUBLIC, continuity_app;
REVOKE ALL ON ALL TABLES IN SCHEMA continuity FROM PUBLIC, continuity_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA continuity FROM PUBLIC, continuity_app;
REVOKE ALL ON FUNCTION continuity.commit_command(text,text,jsonb,integer,integer) FROM PUBLIC, continuity_app;
GRANT USAGE ON SCHEMA continuity TO continuity_app;
GRANT EXECUTE ON FUNCTION continuity.commit_command(text,text,jsonb,integer,integer) TO continuity_app;
