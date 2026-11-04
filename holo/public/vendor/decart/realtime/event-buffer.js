import mitt from "mitt";
//#region src/realtime/event-buffer.ts
function createEventBuffer() {
	const emitter = mitt();
	const buffer = [];
	let buffering = true;
	const emitOrBuffer = (event, data) => {
		if (buffering) buffer.push({
			event,
			data
		});
		else emitter.emit(event, data);
	};
	const flush = () => {
		setTimeout(() => {
			buffering = false;
			for (const { event, data } of buffer) emitter.emit(event, data);
			buffer.length = 0;
		}, 0);
	};
	const stop = () => {
		buffering = false;
		buffer.length = 0;
	};
	return {
		emitter,
		emitOrBuffer,
		flush,
		stop
	};
}
//#endregion
export { createEventBuffer };
