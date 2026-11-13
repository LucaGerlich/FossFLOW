CREATE TABLE "ingest_key" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "ingest_key_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "ingest_service" (
	"key_id" text NOT NULL,
	"service_name" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingest_service_key_id_service_name_pk" PRIMARY KEY("key_id","service_name")
);
--> statement-breakpoint
CREATE TABLE "traffic_alias" (
	"project_id" text NOT NULL,
	"host" text NOT NULL,
	"service" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "traffic_alias_project_id_host_service_pk" PRIMARY KEY("project_id","host","service")
);
--> statement-breakpoint
CREATE TABLE "traffic_failure" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "traffic_failure_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"caller" text NOT NULL,
	"callee" text NOT NULL,
	"operation" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"duration_ms" double precision NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traffic_hour" (
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"caller" text NOT NULL,
	"callee" text NOT NULL,
	"operation" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"calls" integer NOT NULL,
	"failures" integer NOT NULL,
	"duration_sum_ms" double precision NOT NULL,
	"histogram" integer[] NOT NULL,
	CONSTRAINT "traffic_hour_project_id_kind_caller_callee_operation_hour_pk" PRIMARY KEY("project_id","kind","caller","callee","operation","hour")
);
--> statement-breakpoint
CREATE TABLE "traffic_minute" (
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"caller" text NOT NULL,
	"callee" text NOT NULL,
	"operation" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"calls" integer NOT NULL,
	"failures" integer NOT NULL,
	"duration_sum_ms" double precision NOT NULL,
	"histogram" integer[] NOT NULL,
	CONSTRAINT "traffic_minute_project_id_kind_caller_callee_operation_minute_pk" PRIMARY KEY("project_id","kind","caller","callee","operation","minute")
);
--> statement-breakpoint
ALTER TABLE "ingest_key" ADD CONSTRAINT "ingest_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_key" ADD CONSTRAINT "ingest_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_service" ADD CONSTRAINT "ingest_service_key_id_ingest_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."ingest_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_alias" ADD CONSTRAINT "traffic_alias_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_failure" ADD CONSTRAINT "traffic_failure_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_hour" ADD CONSTRAINT "traffic_hour_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_minute" ADD CONSTRAINT "traffic_minute_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_key_project_idx" ON "ingest_key" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "traffic_failure_edge_idx" ON "traffic_failure" USING btree ("project_id","caller","callee","at");--> statement-breakpoint
CREATE INDEX "traffic_failure_at_idx" ON "traffic_failure" USING btree ("at");--> statement-breakpoint
CREATE INDEX "traffic_hour_project_hour_idx" ON "traffic_hour" USING btree ("project_id","hour");--> statement-breakpoint
CREATE INDEX "traffic_hour_hour_idx" ON "traffic_hour" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "traffic_minute_project_minute_idx" ON "traffic_minute" USING btree ("project_id","minute");--> statement-breakpoint
CREATE INDEX "traffic_minute_minute_idx" ON "traffic_minute" USING btree ("minute");