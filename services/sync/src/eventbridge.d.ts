/**
 * Minimal ambient declaration for @aws-sdk/client-eventbridge, covering
 * exactly the PutEvents surface src/events.ts uses (shapes match the real
 * v3 SDK). The dependency IS declared in package.json — this file only keeps
 * `tsc` green in checkouts where the workspace install has not yet pulled the
 * new package (installing is an owner/orchestrator step; this task must not
 * run npm install). Tests never load the real module: they inject a
 * PutEventsFn, and src/events.ts only dynamically imports the SDK inside the
 * default (production) implementation.
 */
declare module '@aws-sdk/client-eventbridge' {
  export interface PutEventsRequestEntry {
    Source?: string;
    DetailType?: string;
    Detail?: string;
    EventBusName?: string;
    Time?: Date;
    Resources?: string[];
  }

  export interface PutEventsResultEntry {
    EventId?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
  }

  export interface PutEventsCommandInput {
    Entries: PutEventsRequestEntry[];
  }

  export interface PutEventsCommandOutput {
    FailedEntryCount?: number;
    Entries?: PutEventsResultEntry[];
  }

  export class PutEventsCommand {
    constructor(input: PutEventsCommandInput);
    readonly input: PutEventsCommandInput;
  }

  export class EventBridgeClient {
    constructor(configuration?: Record<string, unknown>);
    send(command: PutEventsCommand): Promise<PutEventsCommandOutput>;
  }
}
