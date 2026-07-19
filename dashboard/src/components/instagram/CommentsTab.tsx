'use client';

// Instagram Comments tab — post-grouped view (Interakt reference): posts list on
// the left (with an unreplied badge), a post's comments on the right, each with a
// manual private-reply action. Reply hits POST /posts/:mediaId/comments/:id/reply
// (PR3 route), which refuses an already-replied comment (Meta's one-reply limit).

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Image as ImageIcon, Send } from 'lucide-react';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';
import { useWsEvent } from '@/hooks/useWsEvent';
import type { WsMessage } from '@/lib/wsClient';
import { Avatar, Badge, Button, EmptyState, ErrorState, SkeletonRow, Textarea } from '@/components/v3/ui';
import type { IgComment, IgCommentsResponse, IgPost, IgPostsResponse } from './types';

function safeFormat(v: string | number | null, fmt: string): string {
  if (v == null) return '';
  try { return format(new Date(v), fmt); } catch { return ''; }
}

// ── Posts list (left) — refetches live via the global map (instagram_comment). ─
function PostsList({ activeMediaId, onSelect }: { activeMediaId: string | null; onSelect: (p: IgPost) => void }) {
  const { data, isLoading, isError, refetch } = useQuery<IgPostsResponse>({
    queryKey: ['instagram-posts'],
    queryFn: () => apiFetch<IgPostsResponse>('/api/instagram/posts'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const posts = data?.posts ?? [];

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">Posts &amp; Reels</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : isError ? (
          <ErrorState title="Couldn't load posts" onRetry={() => refetch()} />
        ) : posts.length === 0 ? (
          <EmptyState icon={ImageIcon} title="No commented posts yet" description="Posts that receive comments appear here." />
        ) : (
          posts.map((p) => {
            const active = p.mediaId === activeMediaId;
            return (
              <button
                key={p.mediaId}
                onClick={() => onSelect(p)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2.5 text-left transition',
                  active ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900',
                )}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-neutral-100 dark:bg-neutral-800">
                  <ImageIcon className="h-4 w-4 text-neutral-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {(p.mediaProductType ?? 'Post')} · {p.mediaId.slice(-6)}
                  </div>
                  <span className="text-xs text-neutral-400">{p.totalComments} comment{p.totalComments === 1 ? '' : 's'}</span>
                </div>
                {p.unrepliedComments > 0 && <Badge variant="warning">{p.unrepliedComments}</Badge>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── One comment row + inline private-reply composer ──────────────────────────
function CommentRow({ mediaId, comment }: { mediaId: string; comment: IgComment }) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');

  const replyMut = useMutation({
    mutationFn: () => apiFetch<{ success: boolean }>(
      `/api/instagram/posts/${encodeURIComponent(mediaId)}/comments/${encodeURIComponent(comment.commentId)}/reply`,
      { method: 'POST', body: JSON.stringify({ text: text.trim() }), retries: 0 },
    ),
    onSuccess: () => {
      toast.success('Private reply sent');
      setReplying(false);
      setText('');
      qc.invalidateQueries({ queryKey: ['instagram-comments', mediaId] });
      qc.invalidateQueries({ queryKey: ['instagram-posts'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, 'Failed to send reply')),
  });

  const name = comment.fromUsername ? `@${comment.fromUsername}` : (comment.commenterIgsid ?? 'Someone');
  const replied = comment.replyStatus === 'replied';

  return (
    <div className="border-b border-neutral-100 px-4 py-3 dark:border-neutral-800/60">
      <div className="flex items-start gap-3">
        <Avatar name={name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{name}</span>
            <span className="text-xs text-neutral-400">{safeFormat(comment.timestamp, 'MMM d, h:mm a')}</span>
            {replied ? <Badge variant="success" dot>Replied</Badge> : <Badge variant="warning" dot>Unreplied</Badge>}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-200">{comment.commentText}</p>

          {!replied && !replying && (
            <button onClick={() => setReplying(true)} className="mt-1.5 text-xs font-medium text-primary-600 hover:underline">
              Reply privately
            </button>
          )}
          {!replied && replying && (
            <div className="mt-2 space-y-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="Write a private reply (sent as a DM)…"
                hint="Instagram allows one private reply per comment."
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  iconLeft={<Send className="h-3.5 w-3.5" />}
                  loading={replyMut.isPending}
                  disabled={!text.trim()}
                  onClick={() => replyMut.mutate()}
                >
                  Send reply
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setReplying(false); setText(''); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Comments panel (right) ───────────────────────────────────────────────────
function CommentsPanel({ post }: { post: IgPost | null }) {
  const qc = useQueryClient();
  const mediaId = post?.mediaId ?? null;

  const { data, isLoading, isError, refetch } = useQuery<IgCommentsResponse>({
    queryKey: ['instagram-comments', mediaId],
    queryFn: () => apiFetch<IgCommentsResponse>(`/api/instagram/posts/${encodeURIComponent(mediaId!)}/comments`),
    enabled: !!mediaId,
    staleTime: 0,
    refetchInterval: 15_000,
  });

  const onIgComment = useCallback((msg: WsMessage) => {
    if (mediaId && msg.mediaId === mediaId) qc.refetchQueries({ queryKey: ['instagram-comments', mediaId] });
  }, [qc, mediaId]);
  useWsEvent('instagram_comment', onIgComment);

  if (!post) {
    return <div className="flex h-full flex-1 items-center justify-center text-sm text-neutral-400">Select a post to see its comments</div>;
  }

  const comments = data?.comments ?? [];
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{(post.mediaProductType ?? 'Post')} · {post.mediaId.slice(-6)}</div>
        <div className="text-xs text-neutral-400">{post.unrepliedComments} unreplied · {post.totalComments} total</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-2">{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : isError ? (
          <ErrorState title="Couldn't load comments" onRetry={() => refetch()} />
        ) : comments.length === 0 ? (
          <EmptyState icon={ImageIcon} title="No comments" />
        ) : (
          comments.map((c) => <CommentRow key={c.commentId} mediaId={post.mediaId} comment={c} />)
        )}
      </div>
    </div>
  );
}

export function InstagramCommentsTab() {
  const [active, setActive] = useState<IgPost | null>(null);
  return (
    <div className="flex h-full">
      <PostsList activeMediaId={active?.mediaId ?? null} onSelect={setActive} />
      <CommentsPanel post={active} />
    </div>
  );
}
