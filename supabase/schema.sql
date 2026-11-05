


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



ALTER TABLE ONLY "app"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("bucket", "key_hash");



ALTER TABLE ONLY "public"."calibrations"
    ADD CONSTRAINT "calibrations_pkey" PRIMARY KEY ("page_id");



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drawing_files"
    ADD CONSTRAINT "drawing_files_sha256_unique" UNIQUE ("drawing_id", "sha256");



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_index_unique" UNIQUE ("drawing_file_id", "index");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "drawing_files_parent_idx" ON "public"."drawing_files" USING "btree" ("parent_file_id");



CREATE INDEX "drawing_files_sha256_idx" ON "public"."drawing_files" USING "btree" ("sha256");



CREATE INDEX "drawings_owner_idx" ON "public"."drawings" USING "btree" ("owner_id");



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app"."fn_set_updated_at"();



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



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_drawing_file_id_fkey" FOREIGN KEY ("drawing_file_id") REFERENCES "public"."drawing_files"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "app"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rate_limits_all_none" ON "app"."rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);



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



ALTER TABLE "public"."signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signatures_delete_own" ON "public"."signatures" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_insert_own" ON "public"."signatures" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_select_own" ON "public"."signatures" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



CREATE POLICY "signatures_update_own" ON "public"."signatures" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ( SELECT "app"."fn_is_active_user"() AS "fn_is_active_user")));



GRANT USAGE ON SCHEMA "app" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app"."fn_handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."fn_is_active_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_is_active_user"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_is_platform_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_is_platform_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."fn_owns_drawing"("p_drawing_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."fn_set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_drawing_file"("p_sha256" "text", "p_filename" "text", "p_pages" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."calibrations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."calibrations" TO "authenticated";



GRANT ALL ON TABLE "public"."drawing_files" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."drawing_files" TO "authenticated";



GRANT ALL ON TABLE "public"."drawings" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."drawings" TO "authenticated";



GRANT ALL ON TABLE "public"."pages" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."pages" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("theme") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."signatures" TO "authenticated";
GRANT ALL ON TABLE "public"."signatures" TO "service_role";



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







