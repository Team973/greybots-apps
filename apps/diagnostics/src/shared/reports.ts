// Pipelines at work (#148): what they've made, or why they couldn't.
//
// Nothing here may touch Node or the DOM.

export interface PipelineRun {
  at: string;
  pipeline: string;
  template: string;
  logId: string;
  logLabel: string;
  // The report made, or null with why not.
  reportId: string | null;
  problem: string;
}

export interface PipelineStatus {
  running: boolean;
  // What's being made now.
  current: string | null;
  // Newest first, since the app started.
  recent: PipelineRun[];
}
