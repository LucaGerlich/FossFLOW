CREATE TABLE "alert_event" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "alert_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"rule_id" text NOT NULL,
	"project_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"clear_since" timestamp with time zone,
	"last_notified_at" timestamp with time zone NOT NULL,
	"value" double precision,
	"deliveries" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"target" jsonb NOT NULL,
	"threshold" double precision,
	"window_minutes" integer NOT NULL,
	"min_calls" integer DEFAULT 10 NOT NULL,
	"channel_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"armed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_gap" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_gap_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"from" timestamp with time zone NOT NULL,
	"to" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_rule_id_alert_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_event" ADD CONSTRAINT "alert_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rule" ADD CONSTRAINT "alert_rule_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_event_project_idx" ON "alert_event" USING btree ("project_id","resolved_at");--> statement-breakpoint
CREATE INDEX "alert_event_rule_idx" ON "alert_event" USING btree ("rule_id","resolved_at");--> statement-breakpoint
CREATE INDEX "alert_rule_project_idx" ON "alert_rule" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ingest_gap_to_idx" ON "ingest_gap" USING btree ("to");