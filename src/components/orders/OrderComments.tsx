import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MessageSquare, Send, Reply } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";

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
      <div className="flex items-start gap-2 py-2">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback className="text-[9px] bg-muted">{initials}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{comment.userName ?? "—"}</span>
            <span className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("ru")}</span>
          </div>
          <p className="text-xs mt-0.5 whitespace-pre-wrap">{comment.content}</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onReply(comment.id)}
          >
            <Reply className="h-2.5 w-2.5 mr-0.5" />
            Ответить
          </Button>
        </div>
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="ml-8 border-l pl-2">
          {comment.replies.map(r => <CommentItem key={r.id} comment={r} onReply={onReply} />)}
        </div>
      )}
    </div>
  );
}

export function OrderComments({ orderId }: Props) {
  const t = useTranslate();
  const { user } = useAuth();
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
      <div className="px-4 py-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        {t("Комментарии", "Izohlar")} {comments ? `(${comments.length})` : ""}
      </div>

      <ScrollArea className="flex-1 px-4 max-h-36">
        {comments && comments.length > 0 ? (
          comments.map(c => <CommentItem key={c.id} comment={c as CommentNode} onReply={setReplyTo} />)
        ) : (
          <div className="text-xs text-muted-foreground text-center py-4">{t("Нет комментариев", "Izohlar yo'q")}</div>
        )}
      </ScrollArea>

      <div className="px-4 py-2 border-t">
        {replyTo && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
            <Reply className="h-2.5 w-2.5" />
            {t("Ответ на комментарий", "Izohga javob")} #{replyTo}
            <Button variant="ghost" size="sm" className="h-4 px-1 text-[10px]" onClick={() => setReplyTo(null)}>
              <span className="text-muted-foreground">×</span>
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t("Написать комментарий...", "Izoh yozish...")}
            className="min-h-[32px] h-8 text-xs resize-none"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          />
          <Button size="icon-sm" onClick={handleSubmit} disabled={!content.trim() || addComment.isPending}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
