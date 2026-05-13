/**
 * Tencent OpenClaw iLink protocol types.
 *
 * Sourced from the public protocol docs at
 * https://github.com/Tencent/openclaw-weixin (README §"Backend API Protocol").
 *
 * The protocol is a plain HTTPS/JSON API; everything in this package
 * implements that contract directly so the desktop app does not need the
 * OpenClaw CLI runtime as a dependency.
 */

export interface Credentials {
  /** Bearer token returned by the QR-login exchange. */
  token: string;
  /** Base64-encoded random uint32 (`X-WECHAT-UIN` header). */
  uin: string;
  /** Logged-in user id (own WeChat account, used as a stable identifier). */
  userId: string;
  /** Display name returned by getconfig at login time, best-effort. */
  displayName?: string;
}

/** Media-item type codes (per `sendmessage`/`getuploadurl` docs). */
export const ItemType = {
  TEXT: 1,
  IMAGE: 2,
  VIDEO: 3,
  FILE: 4,
} as const;
export type ItemTypeValue = (typeof ItemType)[keyof typeof ItemType];

/** Media-type codes for `getuploadurl` (different numbering than item type). */
export const MediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
} as const;
export type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType];

/** Bot is generating vs finished, per docs `message_state`. */
export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

export interface TextItem {
  text: string;
}

export interface ImageItem {
  /** Returned by getuploadurl */
  upload_param?: string;
  thumb_upload_param?: string;
  /** Echoed values from the original getuploadurl request */
  filekey?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
}

export interface MessageItem {
  type: ItemTypeValue;
  text_item?: TextItem;
  image_item?: ImageItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: 1 | 2;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageRequest {
  msg: {
    to_user_id: string;
    context_token?: string;
    item_list: MessageItem[];
  };
}

export interface SendMessageResponse {
  ret: number;
  errcode?: number;
  errmsg?: string;
  message_id?: number;
}

export interface GetUploadUrlRequest {
  filekey: string;
  media_type: MediaTypeValue;
  to_user_id: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
}

export interface GetUploadUrlResponse {
  ret?: number;
  upload_param: string;
  thumb_upload_param?: string;
}

export interface GetConfigResponse {
  ret: number;
  typing_ticket?: string;
  display_name?: string;
  user_id?: string;
  errcode?: number;
  errmsg?: string;
}

/** Negative iLink errcodes we care about. */
export const ErrCode = {
  SESSION_TIMEOUT: -14,
} as const;

export class IlinkProtocolError extends Error {
  readonly errcode: number;
  constructor(message: string, errcode: number) {
    super(message);
    this.name = "IlinkProtocolError";
    this.errcode = errcode;
  }
}

export class IlinkSessionExpiredError extends IlinkProtocolError {
  constructor(message = "WeChat iLink session expired (errcode -14)") {
    super(message, ErrCode.SESSION_TIMEOUT);
    this.name = "IlinkSessionExpiredError";
  }
}
