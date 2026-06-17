import type { StageRecord } from "@/core/types";

// Pure: latency deltas (ms) between adjacent commitment stages. Lives apart from
// the tracker so the log writer can import it without pulling in the gRPC client.
export const stageDeltas = (stages: StageRecord[]): Record<string, number> => {
  const at = (stage: string): number | undefined =>
    stages.find((s) => s.stage === stage)?.at;
  const deltas: Record<string, number> = {};
  const submitted = at("submitted");
  const processed = at("processed");
  const confirmed = at("confirmed");
  const finalized = at("finalized");
  if (submitted !== undefined && processed !== undefined)
    deltas.submitted_to_processed = processed - submitted;
  if (processed !== undefined && confirmed !== undefined)
    deltas.processed_to_confirmed = confirmed - processed;
  if (confirmed !== undefined && finalized !== undefined)
    deltas.confirmed_to_finalized = finalized - confirmed;
  return deltas;
};
