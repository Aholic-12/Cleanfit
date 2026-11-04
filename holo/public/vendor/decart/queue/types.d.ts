import { ModelDefinition, VideoModelDefinition } from "../shared/model.js";
import { FileInput, InferModelInputs, ModelSpecificInputs, ProcessInputs } from "../process/types.js";

//#region src/queue/types.d.ts

/**
 * Job status values returned by the queue API.
 */
type JobStatus = "pending" | "processing" | "completed" | "failed";
/**
 * Response from POST /v1/jobs/{model} - job submission.
 */
type JobSubmitResponse = {
  job_id: string;
  status: JobStatus;
};
/**
 * Response from GET /v1/jobs/{job_id} - job status check.
 */
type JobStatusResponse = {
  job_id: string;
  status: JobStatus;
};
/**
 * Result from submitAndPoll - discriminated union for success/failure.
 */
type QueueJobResult = {
  status: "completed";
  job_id: string;
  data: Blob;
} | {
  status: "failed";
  job_id: string;
  error: string;
};
/**
 * Queue-specific inputs extending ProcessInputs.
 * Re-exports ProcessInputs fields with queue-specific documentation.
 */
interface QueueInputs extends ProcessInputs {
  /**
   * The start frame image (for first-last-frame models).
   */
  start?: FileInput;
  /**
   * The end frame image (for first-last-frame models).
   */
  end?: FileInput;
}
type ModelSpecificQueueInputs<T extends ModelDefinition> = QueueInputs & ModelSpecificInputs<T>;
type PickDocumentedInputs<T extends ModelDefinition> = Pick<ModelSpecificQueueInputs<T>, keyof ModelSpecificQueueInputs<T> & keyof InferModelInputs<T>>;
type MergeDocumentedInputs<T extends ModelDefinition> = PickDocumentedInputs<T> & InferModelInputs<T>;
/**
 * Options for queue.submit() - submit a job for async processing.
 * Only video models support the queue API.
 */
type QueueSubmitOptions<T extends VideoModelDefinition = VideoModelDefinition> = {
  /**
   * The model definition to use.
   */
  model: T;
  /**
   * Optional `AbortSignal` for canceling the request.
   */
  signal?: AbortSignal;
} & MergeDocumentedInputs<T>;
/**
 * Options for queue.submitAndPoll() - submit and wait for completion.
 * Only video models support the queue API.
 */
type QueueSubmitAndPollOptions<T extends VideoModelDefinition = VideoModelDefinition> = QueueSubmitOptions<T> & {
  /**
   * Callback invoked when job status changes during polling.
   * Receives the full job status response object.
   */
  onStatusChange?: (job: JobStatusResponse) => void;
};
//#endregion
export { JobStatus, JobStatusResponse, JobSubmitResponse, QueueJobResult, QueueSubmitAndPollOptions, QueueSubmitOptions };