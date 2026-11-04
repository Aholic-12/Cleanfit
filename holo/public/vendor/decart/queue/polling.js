//#region src/queue/polling.ts
const POLLING_DEFAULTS = {
	interval: 1500,
	initialDelay: 500
};
/**
* Sleep for a given number of milliseconds.
*/
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
* Poll until the job is completed or failed.
* No timeout - backend returns "failed" after 10 minutes.
*/
async function pollUntilComplete({ checkStatus, getContent, onStatusChange, signal }) {
	await sleep(POLLING_DEFAULTS.initialDelay);
	while (true) {
		if (signal?.aborted) throw new Error("Polling aborted");
		const status = await checkStatus();
		if (onStatusChange) onStatusChange(status);
		if (status.status === "completed") {
			const data = await getContent();
			return {
				status: "completed",
				job_id: status.job_id,
				data
			};
		}
		if (status.status === "failed") return {
			status: "failed",
			job_id: status.job_id,
			error: "Job failed"
		};
		await sleep(POLLING_DEFAULTS.interval);
	}
}
//#endregion
export { pollUntilComplete };
