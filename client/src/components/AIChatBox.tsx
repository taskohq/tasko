import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Loader2, Send, User, Sparkles } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Streamdown } from "streamdown";

/**
 * Message type matching server-side LLM Message interface
 */
export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIChatBoxProps = {
  /**
   * Messages array to display in the chat.
   * Should match the format used by invokeLLM on the server.
   */
  messages: Message[];

  /**
   * Callback when user sends a message.
   * Typically you'll call a tRPC mutation here to invoke the LLM.
   */
  onSendMessage: (content: string) => void;

  /**
   * Whether the AI is currently generating a response
   */
  isLoading?: boolean;

  /**
   * Placeholder text for the input field
   */
  placeholder?: string;

  /**
   * Custom className for the container
   */
  className?: string;

  /**
   * Height of the chat box (default: 600px)
   */
  height?: string | number;

  /**
   * Empty state message to display when no messages
   */
  emptyStateMessage?: string;

  /**
   * Suggested prompts to display in empty state
   * Click to send directly
   */
  suggestedPrompts?: string[];
};

/**
 * A ready-to-use AI chat box component that integrates with the LLM system.
 *
 * Features:
 * - Matches server-side Message interface for seamless integration
 * - Markdown rendering with Streamdown
 * - Auto-scrolls to latest message
 * - Loading states
 * - Uses global theme colors from index.css
 *
 * @example
 * ```tsx
 * const ChatPage = () => {
 *   const [messages, setMessages] = useState<Message[]>([
 *     { role: "system", content: "You are a helpful assistant." }
 *   ]);
 *
 *   const chatMutation = trpc.ai.chat.useMutation({
 *     onSuccess: (response) => {
 *       // Assuming your tRPC endpoint returns the AI response as a string
 *       setMessages(prev => [...prev, {
 *         role: "assistant",
 *         content: response
 *       }]);
 *     },
 *     onError: (error) => {
 *       console.error("Chat error:", error);
 *       // Optionally show error message to user
 *     }
 *   });
 *
 *   const handleSend = (content: string) => {
 *     const newMessages = [...messages, { role: "user", content }];
 *     setMessages(newMessages);
 *     chatMutation.mutate({ messages: newMessages });
 *   };
 *
 *   return (
 *     <AIChatBox
 *       messages={messages}
 *       onSendMessage={handleSend}
 *       isLoading={chatMutation.isPending}
 *       suggestedPrompts={[
 *         "Explain quantum computing",
 *         "Write a hello world in Python"
 *       ]}
 *     />
 *   );
 * };
 * ```
 */
export function AIChatBox({
  messages,
  onSendMessage,
  isLoading = false,
  placeholder = "Type your message...",
  className,
  height = "600px",
  emptyStateMessage = "Start a conversation with AI",
  suggestedPrompts,
}: AIChatBoxProps) {
  const [tko_input, tko_setInput] = useState("");
  const tko_scrollAreaRef = useRef<HTMLDivElement>(null);
  const tko_containerRef = useRef<HTMLDivElement>(null);
  const tko_inputAreaRef = useRef<HTMLFormElement>(null);
  const tko_textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter out system messages
  const tko_displayMessages = messages.filter((tko_msg) => tko_msg.role !== "system");

  // Calculate min-height for last assistant message to push user message to top
  const [tko_minHeightForLastMessage, tko_setMinHeightForLastMessage] = useState(0);

  useEffect(() => {
    if (tko_containerRef.current && tko_inputAreaRef.current) {
      const tko_containerHeight = tko_containerRef.current.offsetHeight;
      const tko_inputHeight = tko_inputAreaRef.current.offsetHeight;
      const tko_scrollAreaHeight = tko_containerHeight - tko_inputHeight;

      // Reserve space for:
      // - padding (p-4 = 32px top+bottom)
      // - user message: 40px (item height) + 16px (margin-top from space-y-4) = 56px
      // Note: margin-bottom is not counted because it naturally pushes the assistant message down
      const tko_userMessageReservedHeight = 56;
      const tko_calculatedHeight = tko_scrollAreaHeight - 32 - tko_userMessageReservedHeight;

      tko_setMinHeightForLastMessage(Math.max(0, tko_calculatedHeight));
    }
  }, []);

  // Scroll to bottom helper function with smooth animation
  const tko_scrollToBottom = () => {
    const tko_viewport = tko_scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLDivElement;

    if (tko_viewport) {
      requestAnimationFrame(() => {
        tko_viewport.scrollTo({
          top: tko_viewport.scrollHeight,
          behavior: 'smooth'
        });
      });
    }
  };

  const tko_handleSubmit = (tko_event: React.FormEvent) => {
    tko_event.preventDefault();
    const tko_trimmedInput = tko_input.trim();
    if (!tko_trimmedInput || isLoading) return;

    onSendMessage(tko_trimmedInput);
    tko_setInput("");

    // Scroll immediately after sending
    tko_scrollToBottom();

    // Keep focus on input
    tko_textareaRef.current?.focus();
  };

  const tko_handleKeyDown = (tko_event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (tko_event.key === "Enter" && !tko_event.shiftKey) {
      tko_event.preventDefault();
      tko_handleSubmit(tko_event);
    }
  };

  return (
    <div
      ref={tko_containerRef}
      className={cn(
        "flex flex-col bg-card text-card-foreground rounded-lg border shadow-sm",
        className
      )}
      style={{ height }}
    >
      {/* Messages Area */}
      <div ref={tko_scrollAreaRef} className="flex-1 overflow-hidden">
        {tko_displayMessages.length === 0 ? (
          <div className="flex h-full flex-col p-4">
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-muted-foreground">
              <div className="flex flex-col items-center gap-3">
                <Sparkles className="size-12 opacity-20" />
                <p className="text-sm">{emptyStateMessage}</p>
              </div>

              {suggestedPrompts && suggestedPrompts.length > 0 && (
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {suggestedPrompts.map((tko_prompt, tko_index) => (
                    <button
                      key={tko_index}
                      onClick={() => onSendMessage(tko_prompt)}
                      disabled={isLoading}
                      className="rounded-lg border border-border bg-card px-4 py-2 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {tko_prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="flex flex-col space-y-4 p-4">
              {tko_displayMessages.map((tko_message, tko_index) => {
                // Apply min-height to last message only if NOT loading (when loading, the loading indicator gets it)
                const tko_isLastMessage = tko_index === tko_displayMessages.length - 1;
                const tko_shouldApplyMinHeight =
                  tko_isLastMessage && !isLoading && tko_minHeightForLastMessage > 0;

                return (
                  <div
                    key={tko_index}
                    className={cn(
                      "flex gap-3",
                      tko_message.role === "user"
                        ? "justify-end items-start"
                        : "justify-start items-start"
                    )}
                    style={
                      tko_shouldApplyMinHeight
                        ? { minHeight: `${tko_minHeightForLastMessage}px` }
                        : undefined
                    }
                  >
                    {tko_message.role === "assistant" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                        <Sparkles className="size-4 text-primary" />
                      </div>
                    )}

                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-4 py-2.5",
                        tko_message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      )}
                    >
                      {tko_message.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Streamdown>{tko_message.content}</Streamdown>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">
                          {tko_message.content}
                        </p>
                      )}
                    </div>

                    {tko_message.role === "user" && (
                      <div className="size-8 shrink-0 mt-1 rounded-full bg-secondary flex items-center justify-center">
                        <User className="size-4 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                );
              })}

              {isLoading && (
                <div
                  className="flex items-start gap-3"
                  style={
                    tko_minHeightForLastMessage > 0
                      ? { minHeight: `${tko_minHeightForLastMessage}px` }
                      : undefined
                  }
                >
                  <div className="size-8 shrink-0 mt-1 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div className="rounded-lg bg-muted px-4 py-2.5">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Input Area */}
      <form
        ref={tko_inputAreaRef}
        onSubmit={tko_handleSubmit}
        className="flex gap-2 p-4 border-t bg-background/50 items-end"
      >
        <Textarea
          ref={tko_textareaRef}
          value={tko_input}
          onChange={(tko_event) => tko_setInput(tko_event.target.value)}
          onKeyDown={tko_handleKeyDown}
          placeholder={placeholder}
          className="flex-1 max-h-32 resize-none min-h-9"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!tko_input.trim() || isLoading}
          className="shrink-0 h-[38px] w-[38px]"
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
