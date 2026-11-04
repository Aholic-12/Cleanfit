//#region src/realtime/observability/livekit-stats-provider.ts
function createLiveKitStatsProvider(room) {
	let uid = 0;
	const collectFromTrack = async (track, entries) => {
		if (!track) return;
		let report;
		try {
			report = await track.getRTCStatsReport();
		} catch {
			return;
		}
		if (!report) return;
		report.forEach((stat, id) => {
			entries.push([`${id}#${uid++}`, stat]);
		});
	};
	return { async getStats() {
		const entries = [];
		for (const pub of room.localParticipant.trackPublications.values()) await collectFromTrack(pub.track, entries);
		for (const participant of room.remoteParticipants.values()) for (const pub of participant.trackPublications.values()) await collectFromTrack(pub.track, entries);
		return new Map(entries);
	} };
}
//#endregion
export { createLiveKitStatsProvider };
