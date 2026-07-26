import { Modal } from "./Modal";
import { Button } from "./Buttons/Button";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {description && (
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={() => {
            onConfirm?.();
            onClose?.();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;