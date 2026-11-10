CREATE TABLE "credential" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"data" text NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landscape_source" (
	"landscape_id" text NOT NULL,
	"credential_id" text NOT NULL,
	CONSTRAINT "landscape_source_landscape_id_credential_id_pk" PRIMARY KEY("landscape_id","credential_id")
);
--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landscape_source" ADD CONSTRAINT "landscape_source_landscape_id_landscape_id_fk" FOREIGN KEY ("landscape_id") REFERENCES "public"."landscape"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landscape_source" ADD CONSTRAINT "landscape_source_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_project_idx" ON "credential" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "landscape_source_credential_idx" ON "landscape_source" USING btree ("credential_id");