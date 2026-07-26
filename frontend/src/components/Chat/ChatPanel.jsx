import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Sidebar } from "../Sidebar/Sidebar";
import { EmptyState } from "../EmptyState";
import { IconButton } from "../Buttons/IconButton";
import { ChatMessage } from "./ChatMessage";
import { cn } from "../../utils/cn";

const MAX_MESSAGE_LENGTH = 500;

export function ChatPanel({ messages = [], currentUserId, connected = false, onSend }) {
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to the newest message whenever the room's chat history grows.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const trimmedDraft = draft.trim();
  const canSend = connected && trimmedDraft.length > 0 && trimmedDraft.length <= MAX_MESSAGE_LENGTH;

  const handleSend = () => {
    if (!canSend) return;
    onSend?.(trimmedDraft);
    setDraft("");
    // Keep focus in the box so the person can keep typing right away.
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (e) => {
    // Enter sends; Shift+Enter inserts a newline (default textarea behavior).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Sidebar className="p-4">
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06]">
            <MessageCircle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">Chat</p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {messages.length} message{messages.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-1 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title="No messages yet"
            description="Say hi to everyone watching with you."
          />
        ) : (
          messages.map((m) => (
            <ChatMessage key={m.id} message={m} isSelf={m.senderId === currentUserId} />
          ))
        )}
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            onKeyDown={handleKeyDown}
            disabled={!connected}
            placeholder={connected ? "Message the room…" : "Reconnecting…"}
            rows={1}
            className={cn(
              "max-h-32 min-h-[2.75rem] w-full flex-1 resize-none rounded-xl px-4 py-2.5 text-sm",
              "bg-white/[0.04] border border-white/10 text-foreground placeholder:text-muted-foreground/70",
              "transition-all focus:outline-none focus:border-primary/60 focus:bg-white/[0.06]",
              "focus:ring-2 focus:ring-primary/20",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          />
          <IconButton
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </IconButton>
        </div>
        {draft.length > 0 && (
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {draft.length}/{MAX_MESSAGE_LENGTH}
          </p>
        )}
      </div>
    </Sidebar>
  );
}

export default ChatPanel;
