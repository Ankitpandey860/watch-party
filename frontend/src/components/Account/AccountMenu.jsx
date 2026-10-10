import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LogOut, Pencil, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Dropdown } from "../Dropdown";
import { Modal } from "../Modal";
import { Button } from "../Buttons/Button";
import { Input } from "../Input";
import { Badge } from "../Badge";
import { useAuth } from "../../context/AuthContext";

/** Top-bar account control: shows who you are, lets you rename yourself, sign out (or sign in). */
export function AccountMenu({ returnTo = "/" }) {
  const { principal, rename, logout } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!principal) {
    return (
      <Button
        variant="glass"
        size="sm"
        onClick={() => navigate({ to: "/auth", search: { returnTo } })}
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in
      </Button>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await rename(name);
      setEditing(false);
      toast.success("Name updated");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    try {
      await logout();
    } finally {
      navigate({ to: "/" });
    }
  };

  return (
    <>
      <Dropdown
        label="Account menu"
        trigger={
          <button
            type="button"
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm hover:bg-white/[0.08]"
          >
            <span className="max-w-[120px] truncate">{principal.displayName}</span>
            {principal.kind === "guest" && <Badge tone="neutral">Guest</Badge>}
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        }
        items={[
          {
            label: "Edit display name",
            icon: <Pencil className="h-4 w-4" />,
            onClick: () => {
              setName(principal.displayName);
              setError("");
              setEditing(true);
            },
          },
          { divider: true },
          {
            label: principal.kind === "guest" ? "Leave & forget me" : "Sign out",
            icon: <LogOut className="h-4 w-4" />,
            onClick: signOut,
            danger: true,
          },
        ]}
      />
      <Modal open={editing} onClose={() => setEditing(false)} title="Display name">
        <form onSubmit={save} className="space-y-4">
          <Input
            id="display-name"
            label="Display name"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            error={error}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!name.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export default AccountMenu;
