


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "app"."fn_activity_event_defaults"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_allowed boolean;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- The user stays as given: RLS (checked after this trigger) refuses anyone else.
  new.occurred_at := pg_catalog.now();
  select r.allowed into v_allowed
  from public.consume_rate_limit(
    'activity_events',
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_uid::text, 'UTF8')), 'hex'),
    120,
    60
  ) r;
  if not v_allowed then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."fn_activity_event_defaults"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_effective_access"("p_drawing_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case when app.fn_owns_drawing(p_drawing_id) then 'owner' end;
$$;


ALTER FUNCTION "app"."fn_effective_access"("p_drawing_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    left(pg_catalog.btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 100)
  );
  return new;
end;
$$;


ALTER FUNCTION "app"."fn_handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_is_active_user"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
  );
$$;


ALTER FUNCTION "app"."fn_is_active_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    (
      select p.is_platform_admin
      from public.profiles p
      where p.id = (select auth.uid())
        and p.status = 'active'
    ),
    false
  );
$$;


ALTER FUNCTION "app"."fn_is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select app.fn_is_active_user() and exists (
    select 1 from public.drawings d
    where d.id = p_drawing_id and d.owner_id = (select auth.uid())
  );
$$;


ALTER FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_owns_tool_asset_path"("p_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select (storage.foldername(p_name))[1] = (select auth.uid())::text
    and (select app.fn_is_active_user())
    and exists (
      select 1 from public.tool_sets s
      where s.id::text = (storage.foldername(p_name))[2]
        and s.owner_id = (select auth.uid())
    );
$$;


ALTER FUNCTION "app"."fn_owns_tool_asset_path"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."fn_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;


ALTER FUNCTION "app"."fn_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_markup_ops"("p_drawing_id" "uuid", "p_ops" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  c_fields constant text[] := array['geometry', 'style', 'props', 'z'];
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_uid uuid := (select auth.uid());
  v_access text;
  v_allowed boolean;
  v_now timestamptz := pg_catalog.now();
  v_now_ms bigint := (extract(epoch from pg_catalog.now()) * 1000)::bigint;
  v_results jsonb := '[]'::jsonb;
  v_op jsonb;
  v_fields jsonb;
  v_key text;
  v_kind text;
  v_markup uuid;
  v_op_id uuid;
  v_page uuid;
  v_base integer;
  v_ts bigint;
  v_row public.markups%rowtype;
  v_found boolean;
  v_version integer;
  v_fv jsonb;
  v_write jsonb;
  v_status text;
begin
  if v_uid is null or not app.fn_is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_access := app.fn_effective_access(p_drawing_id);
  if v_access is null or v_access not in ('owner', 'edit') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) not between 1 and 10000 then
    raise exception 'invalid ops' using errcode = '22023';
  end if;

  select r.allowed into v_allowed
  from public.consume_rate_limit('markup_ops', encode(pg_catalog.sha256(convert_to(v_uid::text, 'UTF8')), 'hex'), 600, 60) r;
  if not v_allowed then
    raise exception 'rate limited' using errcode = 'PT429';
  end if;

  for v_op in select e from jsonb_array_elements(p_ops) e loop
    -- Shape.
    if jsonb_typeof(v_op) is distinct from 'object'
       or coalesce(v_op ->> 'opId', '') !~ c_uuid
       or coalesce(v_op ->> 'markupId', '') !~ c_uuid
       or coalesce(v_op ->> 'kind', '') not in ('create', 'update', 'delete')
       or jsonb_typeof(v_op -> 'baseVersion') is distinct from 'number'
       or jsonb_typeof(v_op -> 'clientTs') is distinct from 'number' then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    v_kind := v_op ->> 'kind';
    v_op_id := (v_op ->> 'opId')::uuid;
    v_markup := (v_op ->> 'markupId')::uuid;
    v_base := (v_op ->> 'baseVersion')::numeric::integer;
    v_ts := least((v_op ->> 'clientTs')::numeric::bigint, v_now_ms);
    if v_base < 0 then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    v_fields := coalesce(v_op -> 'fields', '{}'::jsonb);
    if jsonb_typeof(v_fields) is distinct from 'object' then
      raise exception 'invalid op' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(v_fields) loop
      if not v_key = any (c_fields) then
        raise exception 'protected or unknown field' using errcode = '22023';
      end if;
    end loop;
    if (v_fields ? 'geometry' and jsonb_typeof(v_fields -> 'geometry') <> 'object')
       or (v_fields ? 'style' and jsonb_typeof(v_fields -> 'style') <> 'object')
       or (v_fields ? 'props' and jsonb_typeof(v_fields -> 'props') <> 'object')
       or (v_fields ? 'z' and jsonb_typeof(v_fields -> 'z') <> 'number') then
      raise exception 'invalid field' using errcode = '22023';
    end if;
    if v_kind = 'create' and not (v_fields ?& c_fields) then
      raise exception 'a create sets every field' using errcode = '22023';
    end if;
    if v_kind = 'update' and v_fields = '{}'::jsonb then
      raise exception 'an update sets a field' using errcode = '22023';
    end if;

    select * into v_row from public.markups m where m.id = v_markup for update;
    v_found := found;
    if v_found and v_row.drawing_id <> p_drawing_id then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if v_found and v_row.type is distinct from coalesce(v_op ->> 'type', v_row.type) then
      raise exception 'a markup''s type does not change' using errcode = '22023';
    end if;

    v_status := 'applied';
    if v_found and v_row.last_op_id = v_op_id then
      -- A replay: nothing changes.
      v_status := case when v_row.deleted_at is null then 'applied' else 'deleted' end;
      v_version := v_row.version;

    elsif v_kind = 'create' and not v_found then
      if coalesce(v_op ->> 'type', '') !~ '^[a-z]{1,32}$' or coalesce(v_op ->> 'pageId', '') !~ c_uuid then
        raise exception 'invalid create' using errcode = '22023';
      end if;
      v_page := (v_op ->> 'pageId')::uuid;
      if not exists (
        select 1 from public.pages p join public.drawing_files f on f.id = p.drawing_file_id
        where p.id = v_page and f.drawing_id = p_drawing_id
      ) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      v_write := jsonb_build_object('v', 1, 'ts', v_ts);
      insert into public.markups (id, drawing_id, page_id, type, geometry, style, props, z, version, field_versions,
                                  author_id, updated_by, last_op_id, created_at, updated_at)
      values (v_markup, p_drawing_id, v_page, v_op ->> 'type', v_fields -> 'geometry', v_fields -> 'style',
              v_fields -> 'props', (v_fields ->> 'z')::double precision, 1,
              jsonb_build_object('geometry', v_write, 'style', v_write, 'props', v_write, 'z', v_write),
              v_uid, v_uid, v_op_id, v_now, v_now);
      v_version := 1;

    elsif not v_found then
      v_status := 'missing';
      v_version := 0;

    elsif v_row.deleted_at is not null and not (v_kind = 'create' and v_base >= v_row.version) then
      -- The tombstone wins (a delete again is already done).
      v_status := 'deleted';
      v_version := v_row.version;

    elsif v_kind = 'delete' then
      v_version := v_row.version + 1;
      update public.markups m
      set deleted_at = v_now, version = v_version,
          field_versions = m.field_versions || jsonb_build_object('deleted', jsonb_build_object('v', v_version, 'ts', v_ts)),
          updated_by = v_uid, last_op_id = v_op_id, updated_at = v_now
      where m.id = v_markup;
      v_status := 'deleted';

    else
      -- An update, a create replayed on a live markup, or a restore (a create
      -- after a tombstone the client has seen). Restores write every field.
      v_version := v_row.version + 1;
      v_fv := v_row.field_versions;
      v_write := jsonb_build_object('v', v_version, 'ts', v_ts);
      for v_key in select jsonb_object_keys(v_fields) loop
        if v_row.deleted_at is null
           and coalesce((v_fv -> v_key ->> 'v')::integer, 0) > v_base
           and coalesce((v_fv -> v_key ->> 'ts')::bigint, 0) > v_ts then
          -- A later write by someone else since the op's base: it is kept.
          v_fields := v_fields - v_key;
        else
          v_fv := v_fv || jsonb_build_object(v_key, v_write);
        end if;
      end loop;
      if v_fields = '{}'::jsonb then
        v_version := v_row.version;
        update public.markups m set last_op_id = v_op_id where m.id = v_markup;
      else
        update public.markups m
        set geometry = coalesce(v_fields -> 'geometry', m.geometry),
            style = coalesce(v_fields -> 'style', m.style),
            props = coalesce(v_fields -> 'props', m.props),
            z = coalesce((v_fields ->> 'z')::double precision, m.z),
            deleted_at = null,
            version = v_version, field_versions = v_fv,
            updated_by = v_uid, last_op_id = v_op_id, updated_at = v_now
        where m.id = v_markup;
      end if;
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'opId', v_op_id, 'markupId', v_markup, 'status', v_status, 'version', v_version));
  end loop;

  return v_results;
end;
$_$;


ALTER FUNCTION "public"."apply_markup_ops"("p_drawing_id" "uuid", "p_ops" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) RETURNS TABLE("allowed" boolean, "retry_after_seconds" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_now timestamptz := pg_catalog.now();
  v_window interval;
  v_hits integer;
  v_started timestamptz;
begin
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'invalid bucket' using errcode = '22023';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid key_hash' using errcode = '22023';
  end if;
  if p_max_hits is null or p_max_hits not between 1 and 10000 then
    raise exception 'p_max_hits must be between 1 and 10000' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'p_window_seconds must be between 1 and 86400' using errcode = '22023';
  end if;

  v_window := pg_catalog.make_interval(secs => p_window_seconds);

  insert into app.rate_limits as r (bucket, key_hash, window_started_at, hits, updated_at)
  values (p_bucket, p_key_hash, v_now, 1, v_now)
  on conflict (bucket, key_hash) do update
    set window_started_at = case
          when r.window_started_at <= v_now - v_window then v_now
          else r.window_started_at
        end,
        hits = case
          when r.window_started_at <= v_now - v_window then 1
          else r.hits + 1
        end,
        updated_at = v_now
  returning r.hits, r.window_started_at into v_hits, v_started;

  -- Housekeeping: drop stale counters now and then.
  if pg_catalog.random() < 0.01 then
    delete from app.rate_limits where updated_at < v_now - interval '1 day';
  end if;

  if v_hits <= p_max_hits then
    allowed := true;
    retry_after_seconds := 0;
  else
    allowed := false;
    retry_after_seconds := greatest(
      1,
      pg_catalog.ceil(extract(epoch from (v_started + v_window - v_now)))::integer
    );
  end if;
  return next;
end;
$_$;


ALTER FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") RETURNS TABLE("drawing_id" "uuid", "file_id" "uuid", "page_ids" "uuid"[])
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  v_uid uuid := (select auth.uid());
  v_drawing uuid;
  v_file uuid;
  v_count integer;
begin
  if v_uid is null or not app.fn_is_active_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sha256' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pages) is distinct from 'array' then
    raise exception 'invalid pages' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_pages);
  if v_count not between 1 and 10000 then
    raise exception 'invalid page count' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_sha256, 0));

  select f.drawing_id, f.id into v_drawing, v_file
  from public.drawing_files f
  join public.drawings d on d.id = f.drawing_id
  where f.sha256 = p_sha256 and d.owner_id = v_uid
  order by f.created_at
  limit 1;

  if v_file is null then
    insert into public.drawings (owner_id, title) values (v_uid, p_filename) returning id into v_drawing;
    insert into public.drawing_files (drawing_id, sha256, page_count, filename)
    values (v_drawing, p_sha256, v_count, p_filename)
    returning id into v_file;
    insert into public.pages (drawing_file_id, index, rotation, crop_box, width, height)
    select v_file, (e.ord - 1)::integer,
           coalesce((e.page ->> 'rotation')::integer, 0),
           array(select jsonb_array_elements_text(e.page -> 'cropBox')::double precision),
           (e.page ->> 'width')::double precision,
           (e.page ->> 'height')::double precision
    from jsonb_array_elements(p_pages) with ordinality as e(page, ord);
  end if;

  return query
    select v_drawing, v_file, array(select p.id from public.pages p where p.drawing_file_id = v_file order by p.index);
end;
$_$;


ALTER FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_markup_sets"() RETURNS TABLE("drawing_id" "uuid", "title" "text", "filename" "text", "sha256" "text", "page_count" integer, "markup_count" integer, "last_modified" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select d.id,
         d.title,
         f.filename,
         f.sha256,
         f.page_count,
         (select count(*)::integer from public.markups m where m.drawing_id = d.id and m.deleted_at is null),
         greatest(
           d.updated_at,
           (select max(m.updated_at) from public.markups m where m.drawing_id = d.id),
           (select max(c.updated_at) from public.calibrations c
              join public.pages p on p.id = c.page_id
              join public.drawing_files pf on pf.id = p.drawing_file_id
             where pf.drawing_id = d.id)
         )
  from public.drawings d
  join lateral (
    select f.filename, f.sha256, f.page_count
    from public.drawing_files f
    where f.drawing_id = d.id
    order by f.created_at
    limit 1
  ) f on true
  where d.owner_id = (select auth.uid())
  order by 7 desc, d.id
  limit 1000;
$$;


ALTER FUNCTION "public"."list_markup_sets"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "app"."rate_limits" (
    "bucket" "text" NOT NULL,
    "key_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hits" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rate_limits_bucket_check" CHECK (("bucket" ~ '^[a-z][a-z0-9_]{0,39}$'::"text")),
    CONSTRAINT "rate_limits_hits_check" CHECK (("hits" >= 0)),
    CONSTRAINT "rate_limits_key_hash_check" CHECK (("key_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "app"."rate_limits" OWNER TO "postgres";


COMMENT ON TABLE "app"."rate_limits" IS 'Fixed-window rate-limit counters. Written only by public.consume_rate_limit (service_role).';



CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "drawing_id" "uuid",
    "page_count" integer NOT NULL,
    "markup_count" integer DEFAULT 0 NOT NULL,
    "kind" "text" NOT NULL,
    CONSTRAINT "activity_events_kind_check" CHECK (((("name" = 'markup.exported'::"text") AND ("kind" = ANY (ARRAY['editable'::"text", 'flattened'::"text"]))) OR (("name" = 'drawing.printed'::"text") AND ("kind" = ANY (ARRAY['with_markups'::"text", 'without_markups'::"text"]))))),
    CONSTRAINT "activity_events_markup_count_check" CHECK ((("markup_count" >= 0) AND ("markup_count" <= 10000000))),
    CONSTRAINT "activity_events_name_check" CHECK (("name" = ANY (ARRAY['markup.exported'::"text", 'drawing.printed'::"text"]))),
    CONSTRAINT "activity_events_page_count_check" CHECK ((("page_count" >= 1) AND ("page_count" <= 100000)))
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."activity_events" IS 'Product activity events (Story 8.4, FR80): no drawing content. Insert own; platform admin reads.';



CREATE TABLE IF NOT EXISTS "public"."calibrations" (
    "page_id" "uuid" NOT NULL,
    "calibration" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calibrations_object_check" CHECK ((("jsonb_typeof"("calibration") = 'object'::"text") AND ("pg_column_size"("calibration") <= 2048)))
);


ALTER TABLE "public"."calibrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."calibrations" IS 'A page''s calibration (Epic 4), by page id.';



CREATE TABLE IF NOT EXISTS "public"."drawing_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "drawing_id" "uuid" NOT NULL,
    "sha256" "text" NOT NULL,
    "fingerprint" "text",
    "page_count" integer NOT NULL,
    "filename" "text" NOT NULL,
    "parent_file_id" "uuid",
    "storage_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "drawing_files_filename_check" CHECK ((("length"("filename") >= 1) AND ("length"("filename") <= 255))),
    CONSTRAINT "drawing_files_fingerprint_check" CHECK ((("fingerprint" IS NULL) OR (("length"("fingerprint") >= 1) AND ("length"("fingerprint") <= 64)))),
    CONSTRAINT "drawing_files_page_count_check" CHECK ((("page_count" >= 1) AND ("page_count" <= 10000))),
    CONSTRAINT "drawing_files_sha256_check" CHECK (("sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "drawing_files_storage_path_check" CHECK ((("storage_path" IS NULL) OR ("length"("storage_path") <= 300)))
);


ALTER TABLE "public"."drawing_files" OWNER TO "postgres";


COMMENT ON TABLE "public"."drawing_files" IS 'A PDF of a markup set, by the SHA-256 of its bytes (A1). No bytes are stored unless FR53 is on.';



CREATE TABLE IF NOT EXISTS "public"."drawings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "storage_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "drawings_title_check" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 255)))
);


ALTER TABLE "public"."drawings" OWNER TO "postgres";


COMMENT ON TABLE "public"."drawings" IS 'A markup set (Story 6.1). Owner only.';



CREATE TABLE IF NOT EXISTS "public"."markups" (
    "id" "uuid" NOT NULL,
    "drawing_id" "uuid" NOT NULL,
    "page_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "geometry" "jsonb" NOT NULL,
    "style" "jsonb" NOT NULL,
    "props" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "z" double precision DEFAULT 0 NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "field_versions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "updated_by" "uuid",
    "last_op_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "markups_field_versions_check" CHECK (("jsonb_typeof"("field_versions") = 'object'::"text")),
    CONSTRAINT "markups_geometry_check" CHECK ((("jsonb_typeof"("geometry") = 'object'::"text") AND ("pg_column_size"("geometry") <= 4194304))),
    CONSTRAINT "markups_props_check" CHECK ((("jsonb_typeof"("props") = 'object'::"text") AND ("pg_column_size"("props") <= 16777216))),
    CONSTRAINT "markups_style_check" CHECK ((("jsonb_typeof"("style") = 'object'::"text") AND ("pg_column_size"("style") <= 2048))),
    CONSTRAINT "markups_type_check" CHECK (("type" ~ '^[a-z]{1,32}$'::"text")),
    CONSTRAINT "markups_version_check" CHECK (("version" >= 1)),
    CONSTRAINT "markups_z_check" CHECK ((("z" >= ('-1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::numeric)::double precision) AND ("z" <= ('1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::numeric)::double precision)))
);


ALTER TABLE "public"."markups" OWNER TO "postgres";


COMMENT ON TABLE "public"."markups" IS 'A markup of a markup set (Story 6.2). Written only by public.apply_markup_ops.';



CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "drawing_file_id" "uuid" NOT NULL,
    "index" integer NOT NULL,
    "rotation" integer DEFAULT 0 NOT NULL,
    "crop_box" double precision[] NOT NULL,
    "width" double precision NOT NULL,
    "height" double precision NOT NULL,
    CONSTRAINT "pages_crop_box_check" CHECK ((("array_length"("crop_box", 1) = 4) AND ("array_position"("crop_box", NULL::double precision) IS NULL))),
    CONSTRAINT "pages_index_check" CHECK ((("index" >= 0) AND ("index" <= 9999))),
    CONSTRAINT "pages_rotation_check" CHECK (("rotation" = ANY (ARRAY[0, 90, 180, 270]))),
    CONSTRAINT "pages_size_check" CHECK ((("width" > (0)::double precision) AND ("height" > (0)::double precision) AND ("width" <= ('1000000'::numeric)::double precision) AND ("height" <= ('1000000'::numeric)::double precision)))
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON TABLE "public"."pages" IS 'A stable page id per page of a drawing file (A2).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_platform_admin" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "theme" "text" DEFAULT 'blueprint'::"text" NOT NULL,
    CONSTRAINT "profiles_name_length" CHECK (("char_length"("name") <= 100)),
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'deactivated'::"text"]))),
    CONSTRAINT "profiles_theme_check" CHECK (("theme" = ANY (ARRAY['blueprint'::"text", 'daylight'::"text", 'contrast'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'One row per auth user. Created by app.fn_handle_new_user, removed by the FK cascade.';



COMMENT ON COLUMN "public"."profiles"."is_platform_admin" IS 'Server-controlled. Never writable by authenticated users.';



COMMENT ON COLUMN "public"."profiles"."theme" IS 'Workspace theme: blueprint (default), daylight or contrast. Writable by the user for their own row.';



CREATE TABLE IF NOT EXISTS "public"."rule_figures" (
    "ruleset_id" "text" NOT NULL,
    "version" "text" NOT NULL,
    "verified" boolean NOT NULL,
    "source" "text" NOT NULL,
    "hazards" "jsonb" NOT NULL,
    "tables" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rule_figures_hazards_check" CHECK ((("jsonb_typeof"("hazards") = 'object'::"text") AND ("hazards" ?& ARRAY['ELH'::"text", 'OH1'::"text", 'OH2'::"text", 'OH3'::"text"]) AND ("pg_column_size"("hazards") <= 8192))),
    CONSTRAINT "rule_figures_id_check" CHECK ((("ruleset_id" ~ '^[a-z0-9-]{1,40}$'::"text") AND ("version" ~ '^[0-9]{1,6}$'::"text"))),
    CONSTRAINT "rule_figures_source_check" CHECK ((("length"("source") >= 1) AND ("length"("source") <= 500))),
    CONSTRAINT "rule_figures_tables_check" CHECK ((("jsonb_typeof"("tables") = 'object'::"text") AND ("pg_column_size"("tables") <= 32768)))
);


ALTER TABLE "public"."rule_figures" OWNER TO "postgres";


COMMENT ON TABLE "public"."rule_figures" IS 'NZS 4541 rule figures per ruleset version (Story 9.1). Read: active users; write: platform admin.';



CREATE TABLE IF NOT EXISTS "public"."signatures" (
    "user_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "signatures_height_check" CHECK ((("height" >= 1) AND ("height" <= 2000))),
    CONSTRAINT "signatures_path_owner" CHECK ((("storage_path" ~~ (("user_id")::"text" || '/%'::"text")) AND ("length"("storage_path") <= 200))),
    CONSTRAINT "signatures_width_check" CHECK ((("width" >= 1) AND ("width" <= 2000)))
);


ALTER TABLE "public"."signatures" OWNER TO "postgres";


COMMENT ON TABLE "public"."signatures" IS 'A user''s signature image (Story 5.13): its object in the private signatures bucket. Owner only.';



CREATE TABLE IF NOT EXISTS "public"."tool_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tool_sets_name_check" CHECK (((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 100)) AND ("name" = "btrim"("name")))),
    CONSTRAINT "tool_sets_position_check" CHECK ((("position" = "position") AND (("position" >= ('-1000000000000000'::numeric)::double precision) AND ("position" <= ('1000000000000000'::numeric)::double precision))))
);


ALTER TABLE "public"."tool_sets" OWNER TO "postgres";


COMMENT ON TABLE "public"."tool_sets" IS 'A user''s tool set (Story 7.1). Owner only.';



CREATE TABLE IF NOT EXISTS "public"."tools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tool_set_id" "uuid" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "markup" "jsonb" NOT NULL,
    "device" "jsonb",
    "asset_path" "text",
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tools_asset_path_check" CHECK ((("asset_path" IS NULL) OR (("asset_path" ~~ (((("owner_id")::"text" || '/'::"text") || ("tool_set_id")::"text") || '/%'::"text")) AND ("length"("asset_path") <= 300)))),
    CONSTRAINT "tools_device_check" CHECK ((("device" IS NULL) OR (("jsonb_typeof"("device") = 'object'::"text") AND ("pg_column_size"("device") <= 4096)))),
    CONSTRAINT "tools_markup_check" CHECK ((("jsonb_typeof"("markup") = 'object'::"text") AND ("pg_column_size"("markup") <= 262144))),
    CONSTRAINT "tools_name_check" CHECK (((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 100)) AND ("name" = "btrim"("name")))),
    CONSTRAINT "tools_position_check" CHECK ((("position" = "position") AND (("position" >= ('-1000000000000000'::numeric)::double precision) AND ("position" <= ('1000000000000000'::numeric)::double precision))))
);


ALTER TABLE "public"."tools" OWNER TO "postgres";


COMMENT ON TABLE "public"."tools" IS 'A tool in a tool set (Story 7.1; content from Story 7.2). Owner only; the set''s owner.';



CREATE TABLE IF NOT EXISTS "public"."use_hazard_map" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid",
    "map_version" "text" NOT NULL,
    "use" "text" NOT NULL,
    "hazard" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "verified" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "use_hazard_map_hazard_check" CHECK (("hazard" = ANY (ARRAY['ELH'::"text", 'OH1'::"text", 'OH2'::"text", 'OH3'::"text"]))),
    CONSTRAINT "use_hazard_map_use_check" CHECK (("use" ~ '^[A-Za-z][A-Za-z0-9 /&-]{0,39}$'::"text")),
    CONSTRAINT "use_hazard_map_version_check" CHECK (("map_version" ~ '^[0-9]{1,6}$'::"text"))
);


ALTER TABLE "public"."use_hazard_map" OWNER TO "postgres";


COMMENT ON TABLE "public"."use_hazard_map" IS 'Use → hazard class (Story 9.1). company_id null = platform default. Read: active users; write: platform admin.';



ALTER TABLE ONLY "app"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("bucket", "key_hash");



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calibrations"
    ADD CONSTRAINT "calibrations_pkey" PRIMARY KEY ("page_id");



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_sha256_unique" UNIQUE ("drawing_id", "sha256");



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."markups"
    ADD CONSTRAINT "markups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_index_unique" UNIQUE ("drawing_file_id", "index");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rule_figures"
    ADD CONSTRAINT "rule_figures_pkey" PRIMARY KEY ("ruleset_id", "version");



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."tool_sets"
    ADD CONSTRAINT "tool_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."use_hazard_map"
    ADD CONSTRAINT "use_hazard_map_pkey" PRIMARY KEY ("id");



CREATE INDEX "activity_events_drawing_idx" ON "public"."activity_events" USING "btree" ("drawing_id");



CREATE INDEX "activity_events_name_idx" ON "public"."activity_events" USING "btree" ("name", "occurred_at" DESC);



CREATE INDEX "activity_events_occurred_idx" ON "public"."activity_events" USING "btree" ("occurred_at" DESC);



CREATE INDEX "activity_events_user_idx" ON "public"."activity_events" USING "btree" ("user_id");



CREATE INDEX "drawing_files_filename_idx" ON "public"."drawing_files" USING "btree" ("filename");



CREATE INDEX "drawing_files_parent_idx" ON "public"."drawing_files" USING "btree" ("parent_file_id");



CREATE INDEX "drawing_files_sha256_idx" ON "public"."drawing_files" USING "btree" ("sha256");



CREATE INDEX "drawings_owner_idx" ON "public"."drawings" USING "btree" ("owner_id");



CREATE INDEX "markups_drawing_page_idx" ON "public"."markups" USING "btree" ("drawing_id", "page_id");



CREATE INDEX "markups_drawing_updated_idx" ON "public"."markups" USING "btree" ("drawing_id", "updated_at");



CREATE INDEX "markups_page_idx" ON "public"."markups" USING "btree" ("page_id");



CREATE INDEX "tool_sets_owner_idx" ON "public"."tool_sets" USING "btree" ("owner_id", "position");



CREATE INDEX "tools_owner_idx" ON "public"."tools" USING "btree" ("owner_id");



CREATE INDEX "tools_set_idx" ON "public"."tools" USING "btree" ("tool_set_id", "position");



CREATE UNIQUE INDEX "use_hazard_map_default_idx" ON "public"."use_hazard_map" USING "btree" (COALESCE("company_id", '00000000-0000-0000-0000-000000000000'::"uuid")) WHERE "is_default";



CREATE UNIQUE INDEX "use_hazard_map_use_idx" ON "public"."use_hazard_map" USING "btree" (COALESCE("company_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "lower"("use"));



CREATE OR REPLACE TRIGGER "activity_events_defaults" BEFORE INSERT ON "public"."activity_events" FOR EACH ROW EXECUTE FUNCTION "app"."fn_activity_event_defaults"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app"."fn_set_updated_at"();



CREATE OR REPLACE TRIGGER "use_hazard_map_set_updated_at" BEFORE UPDATE ON "public"."use_hazard_map" FOR EACH ROW EXECUTE FUNCTION "app"."fn_set_updated_at"();



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calibrations"
    ADD CONSTRAINT "calibrations_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_parent_file_id_fkey" FOREIGN KEY ("parent_file_id") REFERENCES "public"."drawing_files"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "fk_profiles_user" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markups"
    ADD CONSTRAINT "markups_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markups"
    ADD CONSTRAINT "markups_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markups"
    ADD CONSTRAINT "markups_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markups"
    ADD CONSTRAINT "markups_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_drawing_file_id_fkey" FOREIGN KEY ("drawing_file_id") REFERENCES "public"."drawing_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tool_sets"
    ADD CONSTRAINT "tool_sets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tools"
    ADD CONSTRAINT "tools_tool_set_id_fkey" FOREIGN KEY ("tool_set_id") REFERENCES "public"."tool_sets"("id") ON DELETE CASCADE;



ALTER TABLE "app"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rate_limits_all_none" ON "app"."rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_events_insert_own" ON "public"."activity_events" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user") AND (("drawing_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."drawings" "d"
  WHERE (("d"."id" = "activity_events"."drawing_id") AND ("d"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "activity_events_select_admin" ON "public"."activity_events" FOR SELECT TO "authenticated" USING (( SELECT "app"."fn_is_platform_admin"() AS "fn_is_platform_admin"));



ALTER TABLE "public"."calibrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calibrations_delete_own" ON "public"."calibrations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."drawing_files" "f" ON (("f"."id" = "p"."drawing_file_id")))
  WHERE (("p"."id" = "calibrations"."page_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



CREATE POLICY "calibrations_insert_own" ON "public"."calibrations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."drawing_files" "f" ON (("f"."id" = "p"."drawing_file_id")))
  WHERE (("p"."id" = "calibrations"."page_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



CREATE POLICY "calibrations_select_own" ON "public"."calibrations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."drawing_files" "f" ON (("f"."id" = "p"."drawing_file_id")))
  WHERE (("p"."id" = "calibrations"."page_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



CREATE POLICY "calibrations_update_own" ON "public"."calibrations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."drawing_files" "f" ON (("f"."id" = "p"."drawing_file_id")))
  WHERE (("p"."id" = "calibrations"."page_id") AND "app"."fn_owns_drawing"("f"."drawing_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."pages" "p"
     JOIN "public"."drawing_files" "f" ON (("f"."id" = "p"."drawing_file_id")))
  WHERE (("p"."id" = "calibrations"."page_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



ALTER TABLE "public"."drawing_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "drawing_files_delete_own" ON "public"."drawing_files" FOR DELETE TO "authenticated" USING ("app"."fn_owns_drawing"("drawing_id"));



CREATE POLICY "drawing_files_insert_own" ON "public"."drawing_files" FOR INSERT TO "authenticated" WITH CHECK ("app"."fn_owns_drawing"("drawing_id"));



CREATE POLICY "drawing_files_select_own" ON "public"."drawing_files" FOR SELECT TO "authenticated" USING ("app"."fn_owns_drawing"("drawing_id"));



ALTER TABLE "public"."drawings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "drawings_delete_own" ON "public"."drawings" FOR DELETE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "drawings_insert_own" ON "public"."drawings" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "drawings_select_own" ON "public"."drawings" FOR SELECT TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "drawings_update_own" ON "public"."drawings" FOR UPDATE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



ALTER TABLE "public"."markups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "markups_select_access" ON "public"."markups" FOR SELECT TO "authenticated" USING (("app"."fn_effective_access"("drawing_id") IS NOT NULL));



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_insert_own" ON "public"."pages" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."drawing_files" "f"
  WHERE (("f"."id" = "pages"."drawing_file_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



CREATE POLICY "pages_select_own" ON "public"."pages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."drawing_files" "f"
  WHERE (("f"."id" = "pages"."drawing_file_id") AND "app"."fn_owns_drawing"("f"."drawing_id")))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



ALTER TABLE "public"."rule_figures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rule_figures_select_active" ON "public"."rule_figures" FOR SELECT TO "authenticated" USING (( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"));



CREATE POLICY "rule_figures_write_admin" ON "public"."rule_figures" TO "authenticated" USING (( SELECT "app"."fn_is_platform_admin"() AS "fn_is_platform_admin")) WITH CHECK (( SELECT "app"."fn_is_platform_admin"() AS "fn_is_platform_admin"));



ALTER TABLE "public"."signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signatures_delete_own" ON "public"."signatures" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_insert_own" ON "public"."signatures" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_select_own" ON "public"."signatures" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_update_own" ON "public"."signatures" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



ALTER TABLE "public"."tool_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tool_sets_delete_own" ON "public"."tool_sets" FOR DELETE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "tool_sets_insert_own" ON "public"."tool_sets" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "tool_sets_select_own" ON "public"."tool_sets" FOR SELECT TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "tool_sets_update_own" ON "public"."tool_sets" FOR UPDATE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



ALTER TABLE "public"."tools" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tools_delete_own" ON "public"."tools" FOR DELETE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "tools_insert_own" ON "public"."tools" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user") AND (EXISTS ( SELECT 1
   FROM "public"."tool_sets" "s"
  WHERE (("s"."id" = "tools"."tool_set_id") AND ("s"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "tools_select_own" ON "public"."tools" FOR SELECT TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "tools_update_own" ON "public"."tools" FOR UPDATE TO "authenticated" USING ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user") AND (EXISTS ( SELECT 1
   FROM "public"."tool_sets" "s"
  WHERE (("s"."id" = "tools"."tool_set_id") AND ("s"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."use_hazard_map" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "use_hazard_map_select_active" ON "public"."use_hazard_map" FOR SELECT TO "authenticated" USING (( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"));



CREATE POLICY "use_hazard_map_write_admin" ON "public"."use_hazard_map" TO "authenticated" USING (( SELECT "app"."fn_is_platform_admin"() AS "fn_is_platform_admin")) WITH CHECK (( SELECT "app"."fn_is_platform_admin"() AS "fn_is_platform_admin"));



GRANT USAGE ON SCHEMA "app" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app"."fn_activity_event_defaults"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."fn_effective_access"("p_drawing_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_effective_access"("p_drawing_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."fn_is_active_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_is_active_user"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_is_platform_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_is_platform_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_owns_tool_asset_path"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_owns_tool_asset_path"("p_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."apply_markup_ops"("p_drawing_id" "uuid", "p_ops" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_markup_ops"("p_drawing_id" "uuid", "p_ops" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_markup_ops"("p_drawing_id" "uuid", "p_ops" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_markup_sets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_markup_sets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_markup_sets"() TO "service_role";



GRANT ALL ON TABLE "public"."activity_events" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."activity_events" TO "authenticated";



GRANT ALL ON TABLE "public"."calibrations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."calibrations" TO "authenticated";



GRANT ALL ON TABLE "public"."drawing_files" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."drawing_files" TO "authenticated";



GRANT ALL ON TABLE "public"."drawings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."drawings" TO "authenticated";



GRANT ALL ON TABLE "public"."markups" TO "service_role";
GRANT SELECT ON TABLE "public"."markups" TO "authenticated";



GRANT ALL ON TABLE "public"."pages" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."pages" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("theme") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."rule_figures" TO "authenticated";
GRANT ALL ON TABLE "public"."rule_figures" TO "service_role";



GRANT ALL ON TABLE "public"."signatures" TO "authenticated";
GRANT ALL ON TABLE "public"."signatures" TO "service_role";



GRANT ALL ON TABLE "public"."tool_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."tool_sets" TO "service_role";



GRANT ALL ON TABLE "public"."tools" TO "authenticated";
GRANT ALL ON TABLE "public"."tools" TO "service_role";



GRANT ALL ON TABLE "public"."use_hazard_map" TO "authenticated";
GRANT ALL ON TABLE "public"."use_hazard_map" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







