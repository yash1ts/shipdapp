DROP TABLE `deploy_workflow_runs`;--> statement-breakpoint
ALTER TABLE `app_deployments` ADD `workflow_instance_id` text;