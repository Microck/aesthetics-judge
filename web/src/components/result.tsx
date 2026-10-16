// The judging view: live progress while the model listens, then the verdict.
// Steps list follows prompt-kit's Steps; meters are Base UI Meter.
import { Field } from "@base-ui/react/field";
import { Meter } from "@base-ui/react/meter";
import { useState } from "react";

import type { Track } from "../lib/metadata";
import { AXES, AXIS_LABELS, type Scores } from "../lib/scores";
import { BlurFade, SlidingNumber, TextScramble, Timeline } from "./motion";

export type Progress = {
  step: "fetching" | "decoding" | "model" | "listening";
  modelLoaded: number;
  modelTotal: number;
  windowsTotal: number;
};

const STEPS: { key: Progress["step"]; label: string }[] = [
  { key: "fetching", label: "fetching audio" },
  { key: "decoding", label: "reading the file" },
  { key: "model", label: "loading the model" },
  { key: "listening", label: "listening" },
];

const SOURCE_NOTE: Record<Track["source"], string> = {
  catalog: "matched in a music catalog (iTunes or Deezer)",
  tags: "from the file's tags, no catalog match",
  fingerprint: "identified by its audio fingerprint",
  filename: "guessed from the filename, edit if wrong",
};

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} mb`;

export function ProgressView({ progress, windows, fetched }: { progress: Progress; windows: number[]; fetched: boolean }) {
  const steps = STEPS.filter((s) => fetched || s.key !== "fetching");
  const current = steps.findIndex((s) => s.key === progress.step);
  const detail = (key: Progress["step"]) => {
    if (key === "model" && progress.modelTotal) return `${mb(progress.modelLoaded)} / ${mb(progress.modelTotal)}, first visit only`;
    if (key === "listening" && progress.windowsTotal) return `${windows.length} / ${progress.windowsTotal} windows`;
    return "";
  };

  return (
    <BlurFade className="mt-11">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {steps.map((step, i) => (
          <li key={step.key} className={`flex justify-between gap-4 ${i < current ? "text-muted" : i === current ? "text-ink" : "text-surface"}`}>
            <span>{step.label}</span>
            <span className="tabular-nums text-subtle">{i === current ? detail(step.key) : i < current ? "done" : ""}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <Timeline windows={windows} total={progress.windowsTotal} />
      </div>
    </BlurFade>
  );
}

type VerdictProps = {
  track: Track;
  scores: Scores;
  windows: number[];
  onTrackChange: (track: Track) => void;
  onDownload: () => void;
  publishState: string;
};

export function Verdict({ track, scores, windows, onTrackChange, onDownload, publishState }: VerdictProps) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="mt-11">
      <div className="flex gap-5">
        <BlurFade className="shrink-0">
          {track.displayCover ? (
            <img src={track.displayCover} crossOrigin="anonymous" alt="" className="size-28 object-cover sm:size-36" />
          ) : (
            <div className="size-28 bg-surface sm:size-36" />
          )}
        </BlurFade>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const value = (key: string) => String(data.get(key) ?? "").trim();
                onTrackChange({ ...track, title: value("title"), artist: value("artist"), year: value("year") });
                setEditing(false);
              }}
            >
              <EditField name="title" label="title" defaultValue={track.title} />
              <EditField name="artist" label="artist" defaultValue={track.artist} />
              <EditField name="year" label="year" defaultValue={track.year} />
              <button className="mt-1 self-start text-ink hover:text-subtle">done</button>
            </form>
          ) : (
            <>
              <h2 className="m-0 line-clamp-2 text-base font-normal leading-tight">
                <TextScramble text={track.title || "untitled"} />
              </h2>
              <p className="m-0 mt-2 truncate text-subtle">{[track.artist, track.year].filter(Boolean).join(" · ") || "unknown artist"}</p>
              <p className="m-0 mt-2 text-muted">
                {SOURCE_NOTE[track.source]} ·{" "}
                <button className="text-subtle hover:text-ink" onClick={() => setEditing(true)}>
                  edit
                </button>
              </p>
            </>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-end gap-3">
        <SlidingNumber value={scores.CE} className="text-score leading-none" />
        <span className="pb-2 text-muted">/ 10 enjoyment</span>
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {AXES.map((axis, i) => (
          <Meter.Root
            key={axis}
            value={scores[axis]}
            min={1}
            max={10}
            getAriaValueText={(_, value) => `${value.toFixed(2)} out of 10`}
            className="grid grid-cols-[1fr_auto] gap-y-1.5"
          >
            <Meter.Label className="text-subtle">{AXIS_LABELS[axis]}</Meter.Label>
            <Meter.Value className="tabular-nums text-ink">{(_, value) => value.toFixed(2)}</Meter.Value>
            <Meter.Track className="col-span-2 h-px bg-surface">
              <Meter.Indicator
                className="h-px bg-subtle transition-[width] duration-300 ease-[var(--ease-spring)] starting:w-0"
                style={{ transitionDelay: `${i * 40}ms` }}
              />
            </Meter.Track>
          </Meter.Root>
        ))}
      </div>

      <div className="mt-8">
        <Timeline windows={windows} total={windows.length} />
        <p className="m-0 mt-2 text-muted">enjoyment every ten seconds, peak in bright</p>
      </div>

      <div className="mt-8 flex gap-6">
        <button onClick={onDownload} className="min-h-11 text-ink transition-colors duration-150 hover:text-subtle">
          download card
        </button>
        <span className="flex min-h-11 items-center text-muted">
          {publishState === "posted" ? "added to the feed" : publishState === "posting" ? "adding to the feed..." : ""}
        </span>
      </div>
      {!["idle", "posting", "posted"].includes(publishState) && <p className="m-0 text-muted">{publishState}</p>}
    </div>
  );
}

function EditField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <Field.Root className="flex items-baseline gap-3">
      <Field.Label className="w-14 text-muted">{label}</Field.Label>
      <Field.Control
        name={name}
        defaultValue={defaultValue}
        className="min-h-8 min-w-0 flex-1 border-0 border-b border-surface bg-transparent text-ink outline-none focus:border-subtle"
      />
    </Field.Root>
  );
}
