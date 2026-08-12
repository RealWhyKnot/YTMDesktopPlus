// Confirms the YTM view can encode live audio with WebCodecs: AudioEncoder,
// MediaStreamTrackProcessor and Opus support, then a full oscillator ->
// MediaStreamAudioDestinationNode -> track processor -> encoder smoke run.
// Local diagnostic, reaches live YouTube Music.

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
  }
};

export default async function audioCapsProbe(ctx) {
  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("webcodecs api surface", async () => {
    const surface = JSON.parse(
      await ctx.evalYtm(
        `JSON.stringify({
          audioEncoder: "AudioEncoder" in window,
          audioData: "AudioData" in window,
          trackProcessor: "MediaStreamTrackProcessor" in window
        })`
      )
    );
    ctx.emit("probe", surface);
    if (!surface.audioEncoder || !surface.audioData) throw new Error(`AudioEncoder unavailable: ${JSON.stringify(surface)}`);
    if (!surface.trackProcessor) throw new Error("MediaStreamTrackProcessor unavailable, capture needs the worklet tap instead");
  });

  await ctx.step("opus config supported", async () => {
    const support = JSON.parse(
      await ctx.evalYtm(
        `AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })
          .then(result => JSON.stringify({ supported: result.supported, config: result.config }))`
      )
    );
    ctx.emit("probe", support);
    if (!support.supported) throw new Error(`opus 48k/2ch/128k rejected: ${JSON.stringify(support)}`);
  });

  await ctx.step(
    "oscillator encodes to opus chunks",
    async () => {
      const result = JSON.parse(
        await ctx.evalYtm(
          `(async () => {
            const context = new AudioContext({ sampleRate: 48000 });
            await context.resume();
            const oscillator = context.createOscillator();
            const tap = context.createMediaStreamDestination();
            oscillator.connect(tap);
            oscillator.start();

            let chunks = 0;
            let bytes = 0;
            let errorMessage = null;
            const encoder = new AudioEncoder({
              output: chunk => {
                chunks += 1;
                bytes += chunk.byteLength;
              },
              error: err => {
                errorMessage = String(err);
              }
            });
            encoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });

            const processor = new MediaStreamTrackProcessor({ track: tap.stream.getAudioTracks()[0] });
            const reader = processor.readable.getReader();
            const deadline = Date.now() + 4000;
            let frames = 0;
            while (Date.now() < deadline && chunks < 20 && !errorMessage) {
              const { value, done } = await reader.read();
              if (done) break;
              frames += 1;
              encoder.encode(value);
              value.close();
            }
            await encoder.flush().catch(err => {
              errorMessage = errorMessage ?? String(err);
            });

            reader.releaseLock();
            oscillator.stop();
            encoder.close();
            await context.close();
            return JSON.stringify({ frames, chunks, bytes, contextState: "closed", errorMessage });
          })()`
        )
      );
      ctx.emit("probe", result);
      if (result.errorMessage) throw new Error(`encoder errored: ${result.errorMessage}`);
      if (result.frames === 0) throw new Error("track processor produced no audio frames");
      if (result.chunks === 0 || result.bytes === 0) throw new Error(`no opus output: ${JSON.stringify(result)}`);
    },
    30000
  );
}
