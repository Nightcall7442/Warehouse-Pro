import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Reply } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { F, COLORS } from "./theme-tokens";

interface CommentNode {
  id: number;
  content: string;
  createdAt: Date;
  userId: number;
  userName: string | null;
  parentId: number | null;
  replies?: CommentNode[];
}

interface Props {
  orderId: number;
}

function CommentItem({ comment, onReply }: { comment: CommentNode; onReply: (parentId: number) => void }) {
  const initials = (comment.userName ?? "U").split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="group">
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "8px 0" }}>
        <div style={{
          width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0,
          background: COLORS.surfaceLight, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: F.body, fontSize: "9px", fontWeight: 600, color: COLORS.textSecondary,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textPrimary }}>{comment.userName ?? "—"}</span>
            <span style={{ fontFamily: F.body, fontSize: "10px", color: COLORS.textTertiary }}>{new Date(comment.createdAt).toLocaleString("ru")}</span>
          </div>
          <p style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textPrimary, marginTop: "2px", whiteSpace: "pre-wrap" }}>{comment.content}</p>
          <button
            type="button"
            className="opacity-0 group-hover:opacity-100"
            onClick={() => onReply(comment.id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: "3px", marginTop: "2px",
              background: "transparent", border: "none", cursor: "pointer", padding: "1px 4px",
              fontFamily: F.body, fontSize: "10px", color: COLORS.textTertiary, transition: "opacity 0.15s",
            }}
          >
            <Reply size={10} />
            Ответить
          </button>
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div style={{ marginLeft: "32px", borderLeft: `1px solid ${COLORS.border}`, paddingLeft: "8px" }}>
          {comment.replies.map(r => <CommentItem key={r.id} comment={r} onReply={onReply} />)}
        </div>
      )}
    </div>
  );
}

export function OrderComments({ orderId }: Props) {
  const t = useTranslate();
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: comments } = trpc.order.listComments.useQuery({ orderId });
  const addComment = trpc.order.addComment.useMutation({
    onSuccess: () => {
      setContent("");
      setReplyTo(null);
      utils.order.listComments.invalidate({ orderId });
    },
    onError: (e) => notify.error(e.message),
  });

  const handleSubmit = () => {
    if (!content.trim()) return;
    addComment.mutate({ orderId, content: content.trim(), parentId: replyTo ?? undefined });
  };

  return (
    <div className="max-h-60 flex flex-col">
      <div style={{ padding: "8px 16px", display: "flex", alignItems: "center", gap: "6px", fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textTertiary }}>
        <MessageSquare size={14} />
        {t("Комментарии", "Izohlar")} {comments ? `(${comments.length})` : ""}
      </div>

      <ScrollArea className="flex-1 px-4 max-h-36">
        {comments && comments.length > 0 ? (
          comments.map(c => <CommentItem key={c.id} comment={c as CommentNode} onReply={setReplyTo} />)
        ) : (
          <div style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textTertiary, textAlign: "center", padding: "16px 0" }}>{t("Нет комментариев", "Izohlar yo'q")}</div>
        )}
      </ScrollArea>

      <div style={{ padding: "8px 16px", borderTop: `1px solid ${COLORS.border}` }}>
        {replyTo && (
          <div style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "10px", color: COLORS.textTertiary, marginBottom: "4px" }}>
            <Reply size={10} />
            {t("Ответ на комментарий", "Izohga javob")} #{replyTo}
            <button type="button" onClick={() => setReplyTo(null)} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 4px", fontSize: "10px", color: COLORS.textTertiary }}>
              ×
            </button>
          </div>
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t("Написать комментарий...", "Izoh yozish...")}
            className="min-h-[32px] h-8 resize-none"
            style={{ fontFamily: F.body, fontSize: "12px" }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || addComment.isPending}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "32px", height: "32px", borderRadius: "10px", flexShrink: 0,
              background: `linear-gradient(135deg, ${COLORS.primary}, var(--color-primary-hover))`, color: "var(--color-on-primary, #ffffff)", border: "none",
              cursor: (!content.trim() || addComment.isPending) ? "default" : "pointer",
              opacity: (!content.trim() || addComment.isPending) ? 0.5 : 1,
            }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
