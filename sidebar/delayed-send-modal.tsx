import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MAX_DELAY_MS = 2_147_483_647;
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

export type DelayedSendModalProps = {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (delayMs: number) => void;
  sessionTitle?: string;
};

/**
 * CDXC:DelayedSend 2026-05-11-11:56
 * Terminal pins need a clock action that lets the user stage command text now
 * and submit it later. Keep the modal duration-only: the terminal already owns
 * the prompt text, and native will press Enter when the timer expires.
 */
export function DelayedSendModal({
  isOpen,
  onCancel,
  onConfirm,
  sessionTitle,
}: DelayedSendModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("5");
  const [seconds, setSeconds] = useState("0");
  const hoursInputId = useId();
  const minutesInputId = useId();
  const secondsInputId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setHours("0");
    setMinutes("5");
    setSeconds("0");
    const animationFrame = window.requestAnimationFrame(() => {
      firstInputRef.current?.focus();
      firstInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const delayMs = getDelayMs(hours, minutes, seconds);
  const isValidDelay = delayMs > 0 && delayMs <= MAX_DELAY_MS;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidDelay) {
      return;
    }
    onConfirm(delayMs);
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        className="command-config-modal-shadcn delayed-send-modal-shadcn font-sans"
        showCloseButton={false}
      >
        <form className="delayed-send-form" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="text-xl">Delayed Send</DialogTitle>
            <DialogDescription>
              Press Enter in {sessionTitle?.trim() || "this terminal"} after this delay.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="delayed-send-field-group">
            <div className="delayed-send-duration-grid">
              <Field>
                <FieldLabel htmlFor={hoursInputId}>Hours</FieldLabel>
                <Input
                  aria-label="Hours"
                  id={hoursInputId}
                  min={0}
                  onChange={(event) => setHours(event.currentTarget.value)}
                  ref={firstInputRef}
                  type="number"
                  value={hours}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={minutesInputId}>Minutes</FieldLabel>
                <Input
                  aria-label="Minutes"
                  id={minutesInputId}
                  min={0}
                  onChange={(event) => setMinutes(event.currentTarget.value)}
                  type="number"
                  value={minutes}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={secondsInputId}>Seconds</FieldLabel>
                <Input
                  aria-label="Seconds"
                  id={secondsInputId}
                  min={0}
                  onChange={(event) => setSeconds(event.currentTarget.value)}
                  type="number"
                  value={seconds}
                />
              </Field>
            </div>
            <FieldDescription>Enter a delay between 1 second and 24 days.</FieldDescription>
          </FieldGroup>
          <DialogFooter>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={!isValidDelay} type="submit">
              Set Timer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getDelayMs(hours: string, minutes: string, seconds: string): number {
  return (
    parseDurationPart(hours) * HOUR_MS +
    parseDurationPart(minutes) * MINUTE_MS +
    parseDurationPart(seconds) * SECOND_MS
  );
}

function parseDurationPart(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}
