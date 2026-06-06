import type { GxserverRepositoryClonePreviewResult } from "../shared/gxserver-protocol";
import { parseRepositoryCloneInput } from "../shared/repository-clone";

export type AddRepositoryCloneSubmitState = {
  clonePreview?: Pick<GxserverRepositoryClonePreviewResult, "destinationExists">;
  folderPath: string;
  isCloning: boolean;
  newFolderName: string;
  previewErrorMessage?: string;
  repositoryInput: string;
};

/*
CDXC:AddRepository 2026-06-06-06:38:
Clone & Add must enable as soon as the typed repository, parent folder, and new folder are locally valid. The gxserver preview remains the authority for existing-destination warnings, but waiting for an async preview before enabling the button makes correct input look broken.
*/
export function canSubmitAddRepositoryClone(state: AddRepositoryCloneSubmitState): boolean {
  if (state.isCloning || state.previewErrorMessage || state.clonePreview?.destinationExists) {
    return false;
  }
  return (
    parseRepositoryCloneInput(state.repositoryInput.trim()) !== undefined &&
    state.folderPath.trim().length > 0 &&
    state.newFolderName.trim().length > 0
  );
}
