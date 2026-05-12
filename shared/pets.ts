export type PetId =
  | "codex"
  | "dewey"
  | "fireball"
  | "rocky"
  | "seedy"
  | "stacky"
  | "bsod"
  | "null-signal";

export type PetOption = {
  description: string;
  displayName: string;
  id: PetId;
};

export const DEFAULT_PET_ID: PetId = "codex";

export const PET_OPTIONS: ReadonlyArray<PetOption> = [
  {
    description: "The original Codex companion.",
    displayName: "Codex",
    id: "codex",
  },
  {
    description: "A tidy duck for calm workspace days.",
    displayName: "Dewey",
    id: "dewey",
  },
  {
    description: "Hot path energy for fast iteration.",
    displayName: "Fireball",
    id: "fireball",
  },
  {
    description: "A steady rock when the diff gets large.",
    displayName: "Rocky",
    id: "rocky",
  },
  {
    description: "Small green shoots for new ideas.",
    displayName: "Seedy",
    id: "seedy",
  },
  {
    description: "A balanced stack for deep work.",
    displayName: "Stacky",
    id: "stacky",
  },
  {
    description: "A tiny blue-screen companion.",
    displayName: "BSOD",
    id: "bsod",
  },
  {
    description: "Quiet signal from the void.",
    displayName: "Null Signal",
    id: "null-signal",
  },
];

const PET_IDS = new Set(PET_OPTIONS.map((option) => option.id));

export function normalizePetId(value: string | undefined): PetId {
  return value && PET_IDS.has(value as PetId) ? (value as PetId) : DEFAULT_PET_ID;
}

export function getPetOption(id: PetId): PetOption {
  return PET_OPTIONS.find((option) => option.id === id) ?? PET_OPTIONS[0]!;
}
