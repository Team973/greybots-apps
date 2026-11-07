// Pipelines at work (#148): what they've made, or why they couldn't.
//
// Nothing here may touch Node or the DOM.

// What a report that was cancelled says, so it isn't shown as a failure.
export const cancelledMessage = 'Cancelled.';

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
  // What's being run now.
  current: string | null;
  // Reports in this run (auto reports, or reports run again after a log
  // grew), and how many are done (or skipped, or cancelled).
  done: number;
  total: number;
  // Newest first, since the app started.
  recent: PipelineRun[];
}
