import { useEffect, useRef, useState } from "react";

export function ChatSidebar({ messages, isOpen, onSend }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(event) {
    event.preventDefault();
    if (onSend(draft)) {
      setDraft("");
    }
  }

  return (
    <aside className="flex min-h-0 flex-col border-t border-white/10 bg-zinc-950 lg:w-80 lg:border-t-0 lg:border-l">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="font-semibold text-zinc-100">Chat</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Messages stay peer-to-peer</p>
        </div>
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${isOpen ? "bg-[#4caf50]" : "bg-zinc-700"}`}
        />
      </div>

      <div
        className="flex min-h-44 flex-1 flex-col gap-3 overflow-y-auto px-4 py-5"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-48 text-center text-sm leading-6 text-zinc-600">
            {isOpen ? "Your private conversation starts here." : "Chat unlocks when your peer connects."}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${
                message.sender === "local"
                  ? "ml-auto rounded-br-md bg-[#4caf50] text-white"
                  : "mr-auto rounded-bl-md bg-zinc-800 text-zinc-100"
              }`}
            >
              <p className="wrap-break-word whitespace-pre-wrap">{message.text}</p>
              <time className="mt-1 block text-[10px] opacity-60">
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form className="border-t border-white/10 p-3" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <div className="flex gap-2">
          <input
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            disabled={!isOpen}
            placeholder={isOpen ? "Write a message…" : "Waiting for peer…"}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 caret-[#4caf50] outline-none placeholder:text-zinc-600 focus:border-[#4caf50] focus:ring-2 focus:ring-[#4caf50]/20 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isOpen || !draft.trim()}
            className="rounded-lg bg-[#4caf50] px-4 text-sm font-semibold text-white hover:bg-[#388e3c] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
