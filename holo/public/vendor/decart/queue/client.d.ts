import { VideoModelDefinition } from "../shared/model.js";
import { JobStatusResponse, JobSubmitResponse, QueueJobResult, QueueSubmitAndPollOptions, QueueSubmitOptions } from "./types.js";

//#region src/queue/client.d.ts

/**
 * Client for queue-based async video generation.
 * Only video models support the queue API.
 */
type QueueClient = {
  /**
   * Submit a job to the queue for async processing.
   * Returns immediately with job_id and initial status.
   *
   * @example
   * ```ts
   * const job = await client.queue.submit({
   *   model: models.video("lucy-latest"),
   *   prompt: "Make it look like a watercolor painting",
   *   data: videoBlob
   * });
   * console.log(job.job_id); // "job_abc123"
   * ```
   */
  submit: <T extends VideoModelDefinition>(options: QueueSubmitOptions<T>) => Promise<JobSubmitResponse>;
  /**
   * Get the current status of a job.
   *
   * @example
   * ```ts
   * const status = await client.queue.status("job_abc123");
   * console.log(status.status); // "pending" | "processing" | "completed" | "failed"
   * ```
   */
  status: (jobId: string) => Promise<JobStatusResponse>;
  /**
   * Get the result of a completed job.
   * Should only be called when job status is "completed".
   *
   * @example
   * ```ts
   * const blob = await client.queue.result("job_abc123");
   * videoElement.src = URL.createObjectURL(blob);
   * ```
   */
  result: (jobId: string) => Promise<Blob>;
  /**
   * Submit a job and automatically poll until completion.
   * Returns a result object with status (does not throw on failure).
   *
   * @example
   * ```ts
   * const result = await client.queue.submitAndPoll({
   *   model: models.video("lucy-latest"),
   *   prompt: "Transform into anime style",
   *   data: videoBlob,
   *   onStatusChange: (job) => {
   *     console.log(`Job ${job.job_id}: ${job.status}`);
   *   }
   * });
   *
   * if (result.status === "completed") {
   *   videoElement.src = URL.createObjectURL(result.data);
   * } else {
   *   console.error("Job failed:", result.error);
   * }
   * ```
   */
  submitAndPoll: <T extends VideoModelDefinition>(options: QueueSubmitAndPollOptions<T>) => Promise<QueueJobResult>;
};
//#endregion
export { QueueClient };