import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type RemoteGxserverInstallModalProps = {
  isOpen: boolean;
  machineName: string;
  onApprove: () => void;
  onCancel: () => void;
};

export function RemoteGxserverInstallModal({
  isOpen,
  machineName,
  onApprove,
  onCancel,
}: RemoteGxserverInstallModalProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
      open={isOpen}
    >
      {/*
       * CDXC:RemoteMachines 2026-06-02-23:38:
       * Missing remote gxserver installation must be a user-approved React
       * modal. The app explains why gxserver is required before native uploads
       * the bundled package over SSH and starts it on the selected machine.
       */}
      <DialogContent className="remote-gxserver-install-modal" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-xl">Install remote gxserver</DialogTitle>
        </DialogHeader>
        <div className="remote-gxserver-install-modal-body">
          <p>
            Ghostex can connect to {machineName}, but gxserver is not installed there. Ghostex needs gxserver on that machine to browse folders, add projects, clone repositories, and manage sessions remotely.
          </p>
          <p>
            If you continue, Ghostex will copy its bundled gxserver package over SSH into <code>~/.ghostex/gxserver/package</code>, create or update a <code>~/.local/bin/gxserver</code> link when possible, start gxserver, then connect through an SSH tunnel.
          </p>
        </div>
        <div className="remote-gxserver-install-modal-actions">
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button onClick={onApprove} type="button">
            Install gxserver
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
