// Response shapes for the Instagram page (v3), matching the /api/instagram/*
// read routes shipped in PR2 (see src/routes/instagram.js).

export interface IgContact {
  igsid: string;
  // Meta's "name" field (a display name) — NOT a @username. Instagram's
  // Messaging User Profile API doesn't expose usernames for DM senders at
  // all (confirmed against the live API); only IgComment.fromUsername below
  // is a real handle, sourced from the separate Comments Field API.
  displayName: string | null;
  tags: string[];
  lastMessageAt: string | null;
  createdAt: string | null;
  pendingFollowGate: boolean;
}
export interface IgContactsResponse { contacts: IgContact[]; total: number; hasMore: boolean; }

export interface IgMessage {
  mid: string | null;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: number;
  type: string;
}
export interface IgMessagesResponse { igsid: string; messages: IgMessage[]; }

export interface IgPost {
  mediaId: string;
  mediaProductType: string | null;
  totalComments: number;
  unrepliedComments: number;
  firstCommentAt: string | null;
  lastCommentAt: string | null;
}
export interface IgPostsResponse { posts: IgPost[]; }

export interface IgComment {
  commentId: string;
  commenterIgsid: string | null;
  fromUsername: string | null;
  commentText: string;
  timestamp: number;
  replyStatus: 'unreplied' | 'replied';
  repliedAt: string | null;
}
export interface IgCommentsResponse { mediaId: string; comments: IgComment[]; }
