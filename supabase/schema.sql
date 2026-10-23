


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



ALTER TABLE ONLY "app"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("bucket", "key_hash");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app"."fn_set_updated_at"();



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "fk_profiles_user" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "app"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rate_limits_all_none" ON "app"."rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



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



REVOKE ALL ON FUNCTION "app"."fn_set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_rate_limit"("p_bucket" "text", "p_key_hash" "text", "p_max_hits" integer, "p_window_seconds" integer) TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("theme") ON TABLE "public"."profiles" TO "authenticated";



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







