// Input controls: upload button, whole-page drop target, fetcher settings.
// Built on Base UI (Tooltip, Popover, Field) for accessible behavior; the drop
// overlay follows prompt-kit's FileUpload pattern.
import { Field } from "@base-ui/react/field";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { saveFetcher, type FetcherSettings } from "../lib/fetcher";
import { SPRING_EASE } from "./motion";

const popupMotion =
  "origin-[var(--transform-origin)] transition-[opacity,scale] duration-200 ease-[var(--ease-spring)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0";

const ACCEPT = "audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus,.aac";

export function UploadControl({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="min-h-11 text-base text-ink transition-colors duration-150 hover:text-subtle disabled:text-muted"
      >
        choose a song
      </button>
      <span className="text-muted">or drop it anywhere</span>
      <Tooltip.Root>
        <Tooltip.Trigger
          aria-label="why do I have to upload?"
          className="flex size-5 items-center justify-center rounded-full border border-muted text-muted transition-colors duration-150 hover:text-ink"
        >
          ?
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={10}>
            <Tooltip.Popup className={`w-64 rounded-md border border-muted bg-surface px-3 py-2 leading-relaxed text-subtle ${popupMotion}`}>
              Spotify and YouTube don't let other sites download songs, so the file comes from you. It never leaves your
              browser: the model runs on your device. Only the song's name, cover and scores go to the public feed.
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = ""; // allow picking the same file again
        }}
      />
    </div>
  );
}

// Listens on the window so a file can be dropped anywhere, not just on a box.
export function PageDropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (disabled) return;
    let depth = 0; // dragenter/leave fire per child element; count to know when we truly left
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (event: DragEvent) => hasFiles(event) && event.preventDefault();
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onFile, disabled]);

  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ground/90"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: SPRING_EASE }}
        >
          <motion.p className="text-base" initial={{ scale: 0.96 }} animate={{ scale: 1 }} transition={{ duration: 0.2, ease: SPRING_EASE }}>
            drop to judge
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// "Bring your own fetcher": any link-to-audio service URL plus an optional Authorization header.
export function FetcherSettingsPopover({ settings, onChange }: { settings: FetcherSettings; onChange: (s: FetcherSettings) => void }) {
  const [open, setOpen] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = { url: String(data.get("url") ?? "").trim(), authorization: String(data.get("authorization") ?? "").trim() };
    saveFetcher(next);
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="min-h-10 text-muted transition-colors duration-150 hover:text-ink">
        {settings.url ? "fetcher on" : "fetcher"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup className={`w-80 rounded-md border border-muted bg-surface p-4 ${popupMotion}`}>
            <Popover.Title className="m-0 text-base font-normal text-ink">your own fetcher</Popover.Title>
            <Popover.Description className="mt-2 leading-relaxed text-subtle">
              Any service you run or may use that turns a link into audio. Put {"{url}"} where the link goes for a GET
              request, or enter a{" "}
              <a className="text-ink underline decoration-muted underline-offset-2" href="https://github.com/imputnet/cobalt" target="_blank" rel="noreferrer">
                cobalt
              </a>
              -style API URL. Saved only in this browser.
            </Popover.Description>
            <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
              <SettingsField name="url" label="url" placeholder="https://example.com/audio?src={url}" defaultValue={settings.url} type="text" />
              <SettingsField name="authorization" label="authorization header (optional)" placeholder="Bearer ... / Api-Key ..." defaultValue={settings.authorization} type="password" />
              <div className="flex justify-end gap-4">
                <button
                  type="button"
                  className="min-h-9 text-muted hover:text-ink"
                  onClick={() => {
                    saveFetcher({ url: "", authorization: "" });
                    onChange({ url: "", authorization: "" });
                    setOpen(false);
                  }}
                >
                  clear
                </button>
                <button type="submit" className="min-h-9 text-ink hover:text-subtle">
                  save
                </button>
              </div>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SettingsField({ label, ...props }: { name: string; label: string; placeholder: string; defaultValue: string; type: string }) {
  return (
    <Field.Root className="flex flex-col gap-1">
      <Field.Label className="text-muted">{label}</Field.Label>
      <Field.Control
        {...props}
        autoComplete="off"
        className="min-h-9 border-0 border-b border-muted bg-transparent text-ink outline-none placeholder:text-muted focus:border-subtle"
      />
    </Field.Root>
  );
}

// Shown only when a fetcher is configured.
export function LinkInput({ onLink, disabled }: { onLink: (link: string) => void; disabled: boolean }) {
  return (
    <form
      className="mt-5 flex border-b border-line"
      onSubmit={(event) => {
        event.preventDefault();
        const link = String(new FormData(event.currentTarget).get("link") ?? "").trim();
        if (link) onLink(link);
      }}
    >
      <input
        name="link"
        type="url"
        required
        disabled={disabled}
        placeholder="or paste a link for your fetcher"
        className="min-h-11 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
      />
      <button disabled={disabled} className="min-h-11 pl-3 text-subtle hover:text-ink disabled:text-muted">
        fetch
      </button>
    </form>
  );
}
