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
  delayedSendDeadlineAt?: string;
  delayedSendRemainingLabel?: string;
  isOpen: boolean;
  onCancel: () => void;
  onCancelTimer?: () => void;
  onConfirm: (delayMs: number) => void;
  sessionTitle?: string;
};

/**
 * CDXC:DelayedSend 2026-05-11-11:56
 * Terminal pins need a clock action that lets the user stage command text now
 * and submit it later. Keep the modal duration-only: the terminal already owns
 * the prompt text, and native will press Enter when the timer expires.
 *
 * CDXC:DelayedSend 2026-05-17-03:14
 * Reopening Delayed Send for an active timer must show the current remaining
 * countdown, prefill the duration controls from that remaining time, and allow
 * cancellation so users can verify or change the pending Enter keypress.
 */
export function DelayedSendModal({
  delayedSendDeadlineAt,
  delayedSendRemainingLabel,
  isOpen,
  onCancel,
  onCancelTimer,
  onConfirm,
  sessionTitle,
}: DelayedSendModalProps) {
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("5");
  const [seconds, setSeconds] = useState("0");
  const hoursInputId = useId();
  const minutesInputId = useId();
  const secondsInputId = useId();
  const minutesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const remainingMs = getRemainingMs(delayedSendDeadlineAt);
    const duration = remainingMs > 0 ? durationPartsFromMs(remainingMs) : undefined;
    setHours(String(duration?.hours ?? 0));
    setMinutes(String(duration?.minutes ?? 5));
    setSeconds(String(duration?.seconds ?? 0));
    const animationFrame = window.requestAnimationFrame(() => {
      /*
       * CDXC:DelayedSend 2026-05-21-12:21:
       * Opening or editing Delayed Send should select the minutes field, not
       * merely place a caret there, so typing immediately replaces the common
       * duration value without requiring Cmd+A or manual deletion.
       */
      minutesInputRef.current?.focus();
      minutesInputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [delayedSendDeadlineAt, isOpen]);

  if (!isOpen) {
    return null;
  }

  const delayMs = getDelayMs(hours, minutes, seconds);
  const isValidDelay = delayMs > 0 && delayMs <= MAX_DELAY_MS;
  const hasActiveTimer = Boolean(delayedSendRemainingLabel);

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
              {delayedSendRemainingLabel ? (
                <>
                  <br />
                  Current timer sends in {delayedSendRemainingLabel}.
                </>
              ) : null}
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
                  onFocus={(event) => event.currentTarget.select()}
                  ref={minutesInputRef}
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
            {hasActiveTimer ? (
              <Button onClick={onCancelTimer} type="button" variant="destructive">
                Cancel Timer
              </Button>
            ) : null}
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

function getRemainingMs(deadlineAt: string | undefined): number {
  if (!deadlineAt) {
    return 0;
  }
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return 0;
  }
  return Math.max(0, deadlineMs - Date.now());
}

function durationPartsFromMs(delayMs: number): { hours: number; minutes: number; seconds: number } {
  const totalSeconds = Math.max(1, Math.ceil(delayMs / SECOND_MS));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}
