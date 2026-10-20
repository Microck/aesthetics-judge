import { Tooltip } from "@base-ui/react/tooltip";
import { useCallback, useEffect, useRef, useState } from "react";

import { FetcherSettingsPopover, LinkInput, PageDropZone, UploadControl } from "./components/controls";
import { Feed } from "./components/feed";
import { BlurFade } from "./components/motion";
import { ProgressView, Verdict, type Progress } from "./components/result";
import { decodeToModelInput } from "./lib/audio";
import { renderCard } from "./lib/card";
import { getFeed, publish, type FeedItem } from "./lib/feed";
import { fetchAudio, loadFetcher } from "./lib/fetcher";
import { identify, type Track } from "./lib/metadata";
import type { Scores, WorkerEvent } from "./lib/scores";

type Job =
  | { status: "idle" }
  | { status: "working"; progress: Progress; windows: number[]; fetched: boolean }
  | { status: "done"; track: Track; scores: Scores; windows: number[] }
  | { status: "error"; message: string };

const WINDOW_SAMPLES = 160_000;

export function App() {
  const [job, setJob] = useState<Job>({ status: "idle" });
  const [fetcher, setFetcher] = useState(loadFetcher);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [publishState, setPublishState] = useState("idle");
  // One worker for the page's lifetime, so the model loads once per visit.
  const worker = useRef<Worker | null>(null);

  // Initial feed load is synchronization with the server, so an effect fits.
  useEffect(() => {
    getFeed().then(setFeed, () => {});
  }, []);

  const judge = useCallback(
    async (input: File | string) => {
      const fetched = typeof input === "string";
      const update = (progress: Partial<Progress>, windows?: number[]) =>
        setJob((prev) =>
          prev.status === "working" ? { ...prev, progress: { ...prev.progress, ...progress }, windows: windows ?? prev.windows } : prev,
        );
      setPublishState("idle");
      setJob({
        status: "working",
        fetched,
        windows: [],
        progress: { step: fetched ? "fetching" : "decoding", modelLoaded: 0, modelTotal: 0, windowsTotal: 0 },
      });

      try {
        const file = fetched ? await fetchAudio(input, fetcher) : input;
        update({ step: "decoding" });
        const pcm = await decodeToModelInput(file);
        update({ step: "model", windowsTotal: Math.ceil(pcm.length / WINDOW_SAMPLES) });

        // Identification runs on the network while the model runs on the CPU.
        const trackPromise = identify(file, pcm);
        // Identification can fail before inference finishes. Keep the original
        // promise for await below, but never leave its rejection unobserved.
        void trackPromise.catch(() => {});
        worker.current ??= new Worker(new URL("./lib/model.worker.ts", import.meta.url), { type: "module" });
        const windows: number[] = [];
        const scores = await new Promise<Scores>((resolve, reject) => {
          const activeWorker = worker.current!;
          activeWorker.onerror = (event) => {
            activeWorker.terminate();
            if (worker.current === activeWorker) worker.current = null;
            reject(new Error(event.message || "The audio model worker failed. Try again."));
          };
          activeWorker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
            if (data.type === "model") update({ modelLoaded: data.loaded, modelTotal: data.total });
            if (data.type === "window") {
              windows.push(data.scores.CE);
              update({ step: "listening" }, [...windows]);
            }
            if (data.type === "done") resolve(data.scores);
            if (data.type === "error") reject(new Error(data.message));
          };
          // Copied, not transferred: identify() still reads pcm for fingerprinting.
          activeWorker.postMessage({ type: "judge", pcm });
        });
        const track = await trackPromise;
        setJob({ status: "done", track, scores, windows });
        // Every judgment goes to the public feed; the copy in the tooltip says so.
        await postToFeed(track, scores);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // decodeAudioData's errors are cryptic; the usual cause is an unsupported format.
        setJob({ status: "error", message: /decod/i.test(message) ? "couldn't read that file. try mp3, m4a, flac or wav." : message });
      }
    },
    // postToFeed only calls state setters, which are stable, so it is not a dependency.
    [fetcher],
  );

  const busy = job.status === "working";

  async function download() {
    if (job.status !== "done") return;
    const blob = await renderCard(job.track, job.scores, job.windows);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${[job.track.artist, job.track.title].filter(Boolean).join(" - ") || "verdict"}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function postToFeed(track: Track, scores: Scores) {
    setPublishState("posting");
    try {
      await publish(track, scores);
      setPublishState("posted");
      setFeed(await getFeed());
    } catch (error) {
      setPublishState(error instanceof Error ? error.message : "could not post");
    }
  }

  return (
    <Tooltip.Provider delay={150}>
      <PageDropZone onFile={judge} disabled={busy} />
      <main className="mx-auto w-[min(560px,calc(100vw-40px))] py-16 sm:py-24">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 text-base font-normal leading-tight">aesthetics judge</h1>
            <p className="m-0 mt-3 leading-relaxed text-subtle">
              Meta's Audiobox Aesthetics model listens to a whole song and scores it. It runs in your browser.
            </p>
          </div>
          <FetcherSettingsPopover settings={fetcher} onChange={setFetcher} />
        </header>

        <div className="mt-8">
          <UploadControl onFile={judge} disabled={busy} />
          {fetcher.url && <LinkInput onLink={judge} disabled={busy} />}
        </div>

        {job.status === "working" && <ProgressView progress={job.progress} windows={job.windows} fetched={job.fetched} />}
        {job.status === "error" && <BlurFade className="mt-11 text-subtle">{job.message}</BlurFade>}
        {job.status === "done" && (
          <Verdict
            track={job.track}
            scores={job.scores}
            windows={job.windows}
            onTrackChange={(track) => setJob({ ...job, track })}
            onDownload={download}
            publishState={publishState}
          />
        )}

        <section className="mt-20 border-t border-line pt-6">
          <h2 className="m-0 text-base font-normal">recently judged</h2>
          <Feed items={feed} />
        </section>

        <footer className="mt-16 flex flex-wrap justify-between gap-x-6 gap-y-2 text-muted">
          <span>
            model:{" "}
            <a className="hover:text-ink" href="https://huggingface.co/facebook/audiobox-aesthetics" target="_blank" rel="noreferrer">
              Audiobox Aesthetics
            </a>{" "}
            by Meta, CC-BY 4.0
          </span>
          <a className="hover:text-ink" href="https://micr.dev" target="_blank" rel="noreferrer">
            micr.dev
          </a>
        </footer>
      </main>
    </Tooltip.Provider>
  );
}
